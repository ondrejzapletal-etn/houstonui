import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Logger,
  Param,
  Post,
  Put,
  UnauthorizedException,
} from '@nestjs/common'
import { CurrentUser, CurrentUserData } from '../auth/current-user.decorator'
import { ClientsService } from './clients.service'
import { CreateClientDto, UpdateClientDto } from './dto/client.dto'

@Controller('clients')
export class ClientsController {
  private readonly logger = new Logger(ClientsController.name)

  constructor(private readonly clients: ClientsService) {}

  /** GlobalAuthGuard authenticates every route here; assert rather than assume. */
  private uid(user: CurrentUserData, op: string): string {
    if (user?.id) return user.id
    this.logger.error(`${op}: reached without an authenticated user – refusing`)
    throw new UnauthorizedException()
  }

  /** GET /api/v1/clients */
  @Get()
  async list(@CurrentUser() user: CurrentUserData) {
    const items = await this.clients.list(this.uid(user, 'list'))
    return { success: true, data: { clients: items } }
  }

  /** POST /api/v1/clients */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(@CurrentUser() user: CurrentUserData, @Body() dto: CreateClientDto) {
    const client = await this.clients.create(this.uid(user, 'create'), dto)
    return { success: true, data: { client } }
  }

  /** PUT /api/v1/clients/:id */
  @Put(':id')
  async update(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
    @Body() dto: UpdateClientDto,
  ) {
    const client = await this.clients.update(id, this.uid(user, 'update'), dto)
    return { success: true, data: { client } }
  }

  /** DELETE /api/v1/clients/:id */
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@CurrentUser() user: CurrentUserData, @Param('id') id: string) {
    await this.clients.remove(id, this.uid(user, 'remove'))
  }
}
