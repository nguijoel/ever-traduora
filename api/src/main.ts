import { NestFactory } from '@nestjs/core';
import { Connection } from 'typeorm';
import { addPipesAndFilters, AppModule } from './app.module';
import { config } from './config';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { ExpressAdapter, NestExpressApplication } from '@nestjs/platform-express';
import { version } from '../package.json';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(
    AppModule,
    new ExpressAdapter(),
  );

  addPipesAndFilters(app);
  
  const isProd = process.env.NODE_ENV === 'production';  // Run migrations (only if enabled)

 if (config.autoMigrate && !isProd) {
    console.log('Running DB migrations if necessary...');
    const connection = app.get(Connection);
    await connection.runMigrations();
    console.log('DB migrations up to date');
  }

  // Swagger
  const swaggerOptions = new DocumentBuilder()
    .setTitle('Traduora API')
    .setDescription(
      [
        '<p>Documentation for the traduora REST API</p>',
        '<p>',
        'Official website: <a target="_blank" href="https://traduora.co">https://traduora.co</a><br/>',
        'Additional documentation: <a target="_blank" href="https://docs.traduora.co">https://docs.traduora.co</a><br/>',
        'Source code: <a target="_blank" href="https://github.com/ever-co/ever-traduora">https://github.com/ever-co/ever-traduora</a>',
        '</p>',
      ].join(''),
    )
    .setVersion(version)
    // If you're on NestJS 6/7, keep setBasePath. If on Nest 8+, remove it.
    .setBasePath('/')
    .addOAuth2({
      type: 'oauth2',
      flows: {
        password: {
          authorizationUrl: '/api/v1/auth/token',
          tokenUrl: '/api/v1/auth/token',
          scopes: [],
        },
      },
    })
    .build();

  const document = SwaggerModule.createDocument(app, swaggerOptions);
  SwaggerModule.setup('api/v1/swagger', app, document, {
    customSiteTitle: 'Traduora API v1 docs',
  });

  // IISNode/Plesk: PORT may be a named pipe string. Do NOT parseInt().
  const listenTarget = process.env.PORT ?? config.port ?? 8080;

  await app.listen(listenTarget as any, '0.0.0.0');

  // Log a sane message for humans (pipe values aren't URL-friendly)
  const displayPort =
    typeof listenTarget === 'string' && listenTarget.startsWith('\\\\.\\pipe\\')
      ? '(iisnode pipe)'
      : listenTarget;

  console.log(`Listening on ${displayPort}`);
  console.log(`Swagger UI available at /api/v1/swagger`);
}

bootstrap().catch((err) => {
  // keep minimal crash visibility in IISNode logs
  // eslint-disable-next-line no-console
  console.error('Bootstrap failed:', err);
  throw err;
});
