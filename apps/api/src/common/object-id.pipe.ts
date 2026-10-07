import { BadRequestException, Injectable } from '@nestjs/common';
import type { PipeTransform } from '@nestjs/common';
import { objectIdSchema } from '@fw-booking/shared';
import { ObjectId } from 'mongodb';

/** Wandelt einen Pfadparameter in eine ObjectId um; ungültige IDs ergeben 400. */
@Injectable()
export class ParseObjectIdPipe implements PipeTransform<string, ObjectId> {
  transform(value: string): ObjectId {
    if (!objectIdSchema.safeParse(value).success) {
      throw new BadRequestException('Ungültige ID');
    }
    return new ObjectId(value);
  }
}
