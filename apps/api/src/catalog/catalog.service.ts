import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { ServiceCreate, ServiceUpdate } from '@fw-booking/shared';
import { Db, MongoClient, ObjectId } from 'mongodb';
import type { AuthenticatedOwner } from '../auth/auth.guard.js';
import { recordAudit } from '../common/audit.js';
import { MONGO_CLIENT, MONGO_DB } from '../database/database.module.js';
import { collections } from '../database/documents.js';
import type { ServiceDocument } from '../database/documents.js';

const ownerActor = (owner: AuthenticatedOwner) =>
  ({ type: 'owner', id: owner.id.toHexString() }) as const;

@Injectable()
export class CatalogService {
  private readonly c;

  constructor(
    @Inject(MONGO_DB) db: Db,
    @Inject(MONGO_CLIENT) private readonly client: MongoClient,
  ) {
    this.c = collections(db);
  }

  list(filter: { active?: boolean } = {}): Promise<ServiceDocument[]> {
    const query = filter.active === undefined ? {} : { active: filter.active };
    return this.c.services.find(query, { sort: { sortOrder: 1, _id: 1 } }).toArray();
  }

  async get(id: ObjectId): Promise<ServiceDocument> {
    const service = await this.c.services.findOne({ _id: id });
    if (!service) throw new NotFoundException('Angebot nicht gefunden');
    return service;
  }

  async create(input: ServiceCreate, owner: AuthenticatedOwner): Promise<ServiceDocument> {
    const now = new Date();
    const last = await this.c.services.findOne({}, { sort: { sortOrder: -1 } });
    const doc: ServiceDocument = {
      ...input,
      _id: new ObjectId(),
      sortOrder: last ? last.sortOrder + 1 : 0,
      createdAt: now,
      updatedAt: now,
    };
    await this.c.services.insertOne(doc);
    await recordAudit(this.c.auditEvents, {
      actor: ownerActor(owner),
      action: 'service.created',
      objectType: 'service',
      objectId: doc._id,
      details: { type: doc.type },
    });
    return doc;
  }

  /**
   * Ändert nur die übermittelten Felder. Die Terminart ist unveränderlich (docs/domain-rules.md).
   * Änderungen wirken nur auf künftige Termine; bestehende Buchungen bleiben unverändert.
   */
  async update(
    id: ObjectId,
    input: ServiceUpdate,
    owner: AuthenticatedOwner,
  ): Promise<ServiceDocument> {
    const existing = await this.get(id);
    if (existing.type !== input.type) {
      throw new ConflictException('Die Terminart eines Angebots kann nicht geändert werden');
    }

    const { bookingRules, ...fields } = input;
    const set: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(fields)) {
      if (key !== 'type' && value !== undefined) set[key] = value;
    }
    for (const [key, value] of Object.entries(bookingRules ?? {})) {
      if (value !== undefined) set[`bookingRules.${key}`] = value;
    }
    const changedFields = Object.keys(set);
    if (changedFields.length === 0) return existing;

    const updated = await this.c.services.findOneAndUpdate(
      { _id: id, type: existing.type },
      { $set: { ...set, updatedAt: new Date() } },
      { returnDocument: 'after' },
    );
    if (!updated) throw new NotFoundException('Angebot nicht gefunden');

    await recordAudit(this.c.auditEvents, {
      actor: ownerActor(owner),
      action:
        set.active === false
          ? 'service.deactivated'
          : set.active === true && !existing.active
            ? 'service.reactivated'
            : 'service.updated',
      objectType: 'service',
      objectId: id,
      details: { fields: changedFields },
    });
    return updated;
  }

  /** Setzt die Reihenfolge aller Angebote; die Liste muss jedes Angebot genau einmal enthalten. */
  async reorder(serviceIds: string[], owner: AuthenticatedOwner): Promise<ServiceDocument[]> {
    await this.client.withSession((session) =>
      session.withTransaction(async () => {
        const existing = await this.c.services
          .find({}, { projection: { _id: 1 }, session })
          .toArray();
        const known = new Set(existing.map((s) => s._id.toHexString()));
        if (known.size !== serviceIds.length || !serviceIds.every((id) => known.has(id))) {
          throw new BadRequestException(
            'Die Reihenfolge muss jedes vorhandene Angebot genau einmal enthalten',
          );
        }
        const now = new Date();
        await this.c.services.bulkWrite(
          serviceIds.map((id, index) => ({
            updateOne: {
              filter: { _id: new ObjectId(id) },
              update: { $set: { sortOrder: index, updatedAt: now } },
            },
          })),
          { session },
        );
        await recordAudit(
          this.c.auditEvents,
          {
            actor: ownerActor(owner),
            action: 'service.reordered',
            objectType: 'service',
            objectId: 'all',
            details: { count: serviceIds.length },
          },
          session,
        );
      }),
    );
    return this.list();
  }
}
