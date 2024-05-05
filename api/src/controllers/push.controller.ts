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

    // Ensure locale is requested project locale
    const projectLocales = await this.projectLocaleRepo.find({
      where: { project: membership.project },
      relations: ['locale']
    });

    if (!projectLocales) {
      throw new NotFoundException('locales not found');
    }

    const result: any[] = [];

    projectLocales.forEach(async (e: ProjectLocale, index: number) => {
      query.locale = e.locale.code;

      const data = await this.serialize(projectId, e, membership, query);

      result.push({
        locale: e.locale.code,
        data
      });

      if (index === projectLocales.length - 1) {
        res.status(HttpStatus.OK);
        res.send(`${projectLocales.length} pushed in total.`);
      }
    });
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
}
