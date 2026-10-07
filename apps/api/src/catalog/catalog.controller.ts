import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import {
  serviceCreateSchema,
  serviceOrderUpdateSchema,
  serviceUpdateSchema,
} from '@fw-booking/shared';
import type { Service, ServiceCreate, ServiceOrderUpdate, ServiceUpdate } from '@fw-booking/shared';
import type { ObjectId } from 'mongodb';
import type { AuthenticatedOwner } from '../auth/auth.guard.js';
import { CurrentOwner } from '../auth/decorators.js';
import { ParseObjectIdPipe } from '../common/object-id.pipe.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { CatalogService } from './catalog.service.js';
import { toServiceDto } from './service.mapper.js';

function parseActiveFilter(value: string | undefined): boolean | undefined {
  if (value === undefined) return undefined;
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new BadRequestException('active muss true oder false sein');
}

/** Angebotsverwaltung für angemeldete Owner. */
@Controller('owner/services')
export class CatalogController {
  constructor(private readonly catalog: CatalogService) {}

  @Get()
  async list(@Query('active') active?: string): Promise<Service[]> {
    const filter = parseActiveFilter(active);
    const services = await this.catalog.list(filter === undefined ? {} : { active: filter });
    return services.map(toServiceDto);
  }

  @Get(':id')
  async get(@Param('id', ParseObjectIdPipe) id: ObjectId): Promise<Service> {
    return toServiceDto(await this.catalog.get(id));
  }

  @Post()
  async create(
    @Body(new ZodValidationPipe(serviceCreateSchema)) body: ServiceCreate,
    @CurrentOwner() owner: AuthenticatedOwner,
  ): Promise<Service> {
    return toServiceDto(await this.catalog.create(body, owner));
  }

  // Muss vor ':id' stehen, damit "order" nicht als ID gelesen wird.
  @Put('order')
  async reorder(
    @Body(new ZodValidationPipe(serviceOrderUpdateSchema)) body: ServiceOrderUpdate,
    @CurrentOwner() owner: AuthenticatedOwner,
  ): Promise<Service[]> {
    return (await this.catalog.reorder(body.serviceIds, owner)).map(toServiceDto);
  }

  @Patch(':id')
  async update(
    @Param('id', ParseObjectIdPipe) id: ObjectId,
    @Body(new ZodValidationPipe(serviceUpdateSchema)) body: ServiceUpdate,
    @CurrentOwner() owner: AuthenticatedOwner,
  ): Promise<Service> {
    return toServiceDto(await this.catalog.update(id, body, owner));
  }
}
