import { BadRequestException, Controller, Get, HttpStatus, NotFoundException, Param, Query, Req, Res, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { InjectRepository } from '@nestjs/typeorm';
import { Request, Response } from 'express';
import { Repository } from 'typeorm';
import { ProjectAction } from '../domain/actions';
import { IntermediateTranslationFormat } from '../domain/formatters';
import { ExportQuery, ImportExportFormat } from '../domain/http';
import { ProjectLocale } from '../entity/project-locale.entity';
import { Term } from '../entity/term.entity';
import { csvExporter } from '../formatters/csv';
import { jsonFlatExporter } from '../formatters/jsonflat';
import { jsonNestedExporter } from '../formatters/jsonnested';
import { propertiesExporter } from '../formatters/properties';
import { xliffExporter } from '../formatters/xliff';
import { yamlFlatExporter } from '../formatters/yaml-flat';
import { yamlNestedExporter } from '../formatters/yaml-nested';
import AuthorizationService from '../services/authorization.service';
import { gettextExporter } from '../formatters/gettext';
import { stringsExporter } from '../formatters/strings';
import { phpExporter } from '../formatters/php';
import { ApiOAuth2, ApiTags, ApiOperation, ApiProduces, ApiResponse } from '@nestjs/swagger';
import { androidXmlExporter } from '../formatters/android-xml';
import { resXExporter } from '../formatters/resx';
import { merge } from 'lodash';
import { ProjectUser } from 'entity/project-user.entity';
import { ProjectClient } from 'entity/project-client.entity';
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";

const env = process.env;

export interface PushItem {
  iso: string;
  language: string;
  data: string | Buffer;
  projectId: string;
}

@Controller('api/v1/projects/:projectId/push')
export class PushController {
  constructor(
    private auth: AuthorizationService,
    @InjectRepository(Term) private termRepo: Repository<Term>,
    @InjectRepository(ProjectLocale)
    private projectLocaleRepo: Repository<ProjectLocale>,
  ) { }

  @Get()
  @UseGuards(AuthGuard())
  @ApiTags('Push')
  @ApiOAuth2([])
  @ApiOperation({ summary: `Pushes all translated terms for a project's locales` })
  @ApiResponse({ status: HttpStatus.OK, description: 'Files pushed' })
  @ApiResponse({ status: HttpStatus.BAD_REQUEST, description: 'Bad request' })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'Project or locale not found' })
  @ApiResponse({ status: HttpStatus.UNAUTHORIZED, description: 'Unauthorized' })
  async push(@Req() req: Request, @Res() res: Response, @Param('projectId') projectId: string, @Query() query: ExportQuery) {

    const user = this.auth.getRequestUserOrClient(req);
    const membership = await this.auth.authorizeProjectAction(user, projectId, ProjectAction.ExportTranslation);

    if (!query.locale) {
      throw new BadRequestException('locale is a required param');
    }

    const  where: any = { project: membership.project };

    if(query.locale !== 'xx') where.locale =  {code: query.locale};

    // Ensure locale is requested project locale
    const projectLocales = await this.projectLocaleRepo.find({ // Fetch all
        where,
        relations: ['locale']
    });

    if (!projectLocales) {
      throw new NotFoundException('locales not found');
    }

    const items: PushItem[] = [];

    projectLocales.forEach(async (e: ProjectLocale) => {

      const qs = { ...query, locale: e.locale.code };

      const data = await this.serialize(projectId, e, membership, qs);

      items.push({
        iso: e.locale.code,
        language: e.locale.language,
        projectId,
        data
      });

      if (items.length === projectLocales.length) {
        const result = await this.toS3(items, query.format);
        res.status(HttpStatus.OK);
        res.send(result);
      }
    });
  }

  private async toS3(items: PushItem[], format: ImportExportFormat): Promise<any> {

    const client = new S3Client({
      region: env.TR_DB_AWS_REGION,
      credentials: {
        accessKeyId: env.TR_DB_AWS_ACCESS_KEY_ID,
        secretAccessKey: env.TR_DB_AWS_SECRET_ACCESS_KEY
      }
    });

    return new Promise((resolve, reject) => {
      try {


        const detail: any[] = [];


        items.forEach(async (e: PushItem) => {
          const params: any = {
            Bucket: env.TR_DB_AWS_BUCKET,
            Key: this.buildPath(e.projectId, e.iso),
            Body: e.data,
            ContentType: this.getContentType(format),
          };

          const command = new PutObjectCommand(params);
          const r = await client.send(command);
          detail.push({
            language: e.language,
            path: params.Key
          });

          if (detail.length === items.length) resolve({
            message: `Pushed ${detail.length} locales to S3`,
            project_id: e.projectId,
            detail
          });
        });
      } catch (err) {
        reject(err)
      }
    });
  }

  private buildPath(projectId: string, iso: string): string {
    return `site_${projectId}/locale/${iso}`;
  }

  private async serialize(projectId: string, projectLocale: ProjectLocale, membership: ProjectClient | ProjectUser, query: ExportQuery): Promise<string | Buffer> {
    const queryBuilder = this.termRepo
      .createQueryBuilder('term')
      .leftJoinAndSelect('term.translations', 'translation', 'translation.projectLocaleId = :projectLocaleId', {
        projectLocaleId: projectLocale.id,
      })
      .where('term.projectId = :projectId', { projectId })
      .orderBy('term.value', 'ASC');

    if (query.untranslated) {
      queryBuilder.andWhere("translation.value = ''");
    }

    const termsWithTranslations = await queryBuilder.getMany();

    let termsWithTranslationsMapped = termsWithTranslations.map(t => ({
      term: t.value,
      translation: t.translations.length === 1 ? t.translations[0].value : '',
    }));

    if (query.fallbackLocale) {
      termsWithTranslationsMapped = termsWithTranslationsMapped.filter(t => t.translation !== '');
    }

    const data: IntermediateTranslationFormat = {
      iso: query.locale,
      translations: termsWithTranslationsMapped,
    };

    let serialized = await this.dump(query.format, data);

    if (query.fallbackLocale) {
      const fallbackProjectLocale = await this.projectLocaleRepo.findOne({
        where: {
          project: membership.project,
          locale: {
            code: query.fallbackLocale,
          },
        },
      });

      if (fallbackProjectLocale) {
        const fallbackTermsWithTranslations = await this.termRepo
          .createQueryBuilder('term')
          .leftJoinAndSelect('term.translations', 'translation', 'translation.projectLocaleId = :projectLocaleId', {
            projectLocaleId: fallbackProjectLocale.id,
          })
          .where('term.projectId = :projectId', { projectId })
          .orderBy('term.value', 'ASC')
          .getMany();

        const fallbackTermsWithTranslationsMapped = fallbackTermsWithTranslations.map(t => ({
          term: t.value,
          translation: t.translations.length === 1 ? t.translations[0].value : '',
        }));

        const dataWithFallback: IntermediateTranslationFormat = {
          iso: query.locale,
          translations: merge(fallbackTermsWithTranslationsMapped, data.translations),
        };

        serialized = await this.dump(query.format, dataWithFallback);
      }
    }

    return serialized;
  }

  private async dump(format: ImportExportFormat, data: IntermediateTranslationFormat): Promise<string | Buffer> {
    switch (format) {
      case 'androidxml':
        return await androidXmlExporter(data);
      case 'csv':
        return await csvExporter(data);
      case 'xliff12':
        return await xliffExporter({ version: '1.2' })(data);
      case 'jsonflat':
        return await jsonFlatExporter(data);
      case 'jsonnested':
        return await jsonNestedExporter(data);
      case 'yamlflat':
        return await yamlFlatExporter(data);
      case 'yamlnested':
        return await yamlNestedExporter(data);
      case 'properties':
        return await propertiesExporter(data);
      case 'po':
        return await gettextExporter(data);
      case 'strings':
        return await stringsExporter(data);
      case 'php':
        return await phpExporter(data);
      case 'resx':
        return await resXExporter(data);
      default:
        throw new Error('Export format not implemented');
    }
  }

  private getContentType(format: ImportExportFormat): string {
    switch (format) {

      case 'androidxml':
        return 'application/xml';

      case 'csv':
        return 'text/csv';

      case 'jsonflat':
      case 'jsonnested':
        return 'application/json';

      case 'strings':
        return 'text/plain';

      case 'php':
      case 'resx':
      case 'xliff12':
      case 'yamlflat':
      case 'yamlnested':
        return 'application/octet-stream';

      default:
        return 'application/octet-stream';
    }
  }
}
