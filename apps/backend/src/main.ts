import 'reflect-metadata'
import { NestFactory } from '@nestjs/core'
import { ValidationPipe } from '@nestjs/common'
import cookieParser = require('cookie-parser')
import { ConfigService } from '@nestjs/config'
import { AppModule } from './app.module'

async function bootstrap() {
  const app = await NestFactory.create(AppModule)
  app.setGlobalPrefix('api/v1')
  app.use(cookieParser())
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  )
  const corsOrigin =
    app.get(ConfigService).get<string>('CORS_ORIGIN') ?? 'http://localhost:5173'
  app.enableCors({ origin: corsOrigin, credentials: true })
  await app.listen(3000)
  console.log('Houston Backend running on http://localhost:3000')
}

bootstrap()
