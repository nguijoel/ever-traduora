// api\src\controllers\push.controller.ts
/**
 * ONTOO:CONTROLLERS - PushController
 */

import { BadRequestException, Controller, HttpStatus, NotFoundException, Param, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { InjectRepository } from '@nestjs/typeorm';
import { Request, Response } from 'express';
import { In, Repository } from 'typeorm';
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
import { ProjectUser } from '../entity/project-user.entity';
import { ProjectClient } from '../entity/project-client.entity';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { CloudFrontClient, CreateInvalidationCommand } from '@aws-sdk/client-cloudfront';

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
  ) {}

  @Post()
  @UseGuards(AuthGuard())
  @ApiTags('Push')
  @ApiOAuth2([])
  @ApiOperation({ summary: `Pushes all translated terms for a project's locales` })
  @ApiResponse({ status: HttpStatus.OK, description: 'Files pushed' })
  @ApiResponse({ status: HttpStatus.BAD_REQUEST, description: 'Bad request' })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'Project or locale not found' })
  @ApiResponse({ status: HttpStatus.UNAUTHORIZED, description: 'Unauthorized' })
  async pushPost(@Req() req: Request, @Res() res: Response, @Param('projectId') projectId: string, @Query() query: ExportQuery) {
    return this.handlePush(req, res, projectId, query);
  }

  private async handlePush(req: Request, res: Response, projectId: string, query: ExportQuery) {
    const user = this.auth.getRequestUserOrClient(req);
    const membership = await this.auth.authorizeProjectAction(user, projectId, ProjectAction.ExportTranslation);

    if (!query.locale) {
      throw new BadRequestException('locale is a required param');
    }

    if (!query.format) {
      throw new BadRequestException('format is a required param');
    }

    const where: any = { project: { id: membership.project.id } };

    const rawLocales = req.query?.locales;
    const locales = typeof rawLocales === 'string'
      ? rawLocales
          .split(',')
          .map(l => String(l).trim())
          .filter(Boolean)
      : [];

    if (locales.length) {
      where.locale = { code: In(locales) };
    } else if (query.locale !== 'xx') {
      where.locale = { code: query.locale };
    }

    // Ensure locale is requested project locale
    const projectLocales = await this.projectLocaleRepo.find({
      // Fetch all
      where,
      relations: ['locale'],
    });

    if (!projectLocales || projectLocales.length === 0) {
      throw new NotFoundException('locales not found');
    }

    const items: PushItem[] = [];

    for (const e of projectLocales) {
      const qs = { ...query, locale: e.locale.code };
      const data = await this.serialize(projectId, e, membership, qs);

      items.push({
        iso: e.locale.code,
        language: e.locale.language,
        projectId,
        data,
      });
    }

    if (items.length === 0) {
      throw new NotFoundException('No locales to push');
    }

    const result = await this.toS3(items, query.format);
    return res.status(HttpStatus.OK).send(result);
  }

  private async toS3(items: PushItem[], format: ImportExportFormat): Promise<any> {
    if (!process.env.TR_AWS_S3_REGION) {
      throw new BadRequestException('TR_AWS_S3_REGION is required');
    }
    if (!process.env.TR_AWS_ACCESS_KEY_ID) {
      throw new BadRequestException('TR_AWS_ACCESS_KEY_ID is required');
    }
    if (!process.env.TR_AWS_SECRET_ACCESS_KEY) {
      throw new BadRequestException('TR_AWS_SECRET_ACCESS_KEY is required');
    }
    if (!process.env.TR_AWS_S3_BUCKET) {
      throw new BadRequestException('TR_AWS_S3_BUCKET is required');
    }

    const client = new S3Client({
      region: process.env.TR_AWS_S3_REGION,
      credentials: {
        accessKeyId: process.env.TR_AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.TR_AWS_SECRET_ACCESS_KEY,
      },
    });

    const detail = await Promise.all(
      items.map(async e => {
        const params: any = {
          Bucket: process.env.TR_AWS_S3_BUCKET,
          Key: this.buildPath(e.projectId, e.iso, format),
          Body: e.data,
          ContentType: this.getContentType(format),
        };

        const command = new PutObjectCommand(params);
        await client.send(command);

        return {
          language: e.language,
          path: params.Key,
        };
      }),
    );

    const invalidation = await this.invalidateCloudFront(
      items[0]?.projectId,
      detail.map(d => d.path),
    );

    return {
      message: `Pushed ${detail.length} locales to S3`,
      project_id: items[0]?.projectId,
      detail,
      invalidation,
    };
  }

  private async invalidateCloudFront(projectId: string | undefined, keys: string[]): Promise<any | undefined> {
    if (!projectId) {
      return undefined;
    }

    const distributionId = process.env.TR_AWS_CLOUDFRONT_DISTRIBUTION_ID;
    if (!distributionId) {
      return undefined;
    }

    if (!process.env.TR_AWS_ACCESS_KEY_ID || !process.env.TR_AWS_SECRET_ACCESS_KEY) {
      return undefined;
    }

    const paths = Array.from(
      new Set(
        (keys || [])
          .map(k => `/${String(k || '').replace(/^\/+/, '')}`)
          .filter(p => p.length > 1),
      ),
    ).slice(0, 1000);

    if (!paths.length) {
      return undefined;
    }

    try {
      const client = new CloudFrontClient({
        region: 'us-east-1',
        credentials: {
          accessKeyId: process.env.TR_AWS_ACCESS_KEY_ID,
          secretAccessKey: process.env.TR_AWS_SECRET_ACCESS_KEY,
        },
      });

      const command = new CreateInvalidationCommand({
        DistributionId: distributionId,
        InvalidationBatch: {
          CallerReference: `${projectId}-${Date.now()}`,
          Paths: {
            Quantity: paths.length,
            Items: paths,
          },
        },
      });

      const result = await client.send(command);

      return {
        distributionId,
        invalidationId: result?.Invalidation?.Id,
        status: result?.Invalidation?.Status,
        quantity: paths.length,
      };
    } catch (error) {
      console.error('CloudFront invalidation failed', error);
      return {
        distributionId,
        error: error?.message || String(error),
      };
    }
  }

  private buildPath(projectId: string, iso: string, format?: ImportExportFormat): string {
    const ext = format ? this.getExt(format) : 'json';
    const keyTemplate = process.env.TR_AWS_S3_KEY_TEMPLATE || 'resource/{id}/{iso}/{iso}.{ext}';

    return keyTemplate
      .replace(/\{id\}/g, projectId)
      .replace(/\{iso\}/g, iso)
      .replace(/\{ext\}/g, ext);
  }

  private async serialize(
    projectId: string,
    projectLocale: ProjectLocale,
    membership: ProjectClient | ProjectUser,
    query: ExportQuery,
  ): Promise<string | Buffer> {
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

  private getExt(format: ImportExportFormat): string {
    switch (format) {
      case 'androidxml':
        return 'xml';
      case 'csv':
        return 'csv';
      case 'xliff12':
        return 'xlf';
      case 'jsonflat':
      case 'jsonnested':
        return 'json';
      case 'yamlflat':
      case 'yamlnested':
        return 'yml';
      case 'properties':
        return 'properties';
      case 'po':
        return 'po';
      case 'strings':
        return 'strings';
      case 'php':
        return 'php';
      case 'resx':
        return 'resx';
      default:
        return 'bin';
    }
  }
}
