import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { DatabaseService } from '../database/database.service.js';
import { CatalogueWrites, type CatalogueActor } from './catalogue-writes.js';
import {
  commandInput,
  objectInput,
  revisionInput,
  uuidInput,
} from './catalogue.input.js';
import { readProduct, recordHistory } from './catalogue.repository.js';
import { photoInput } from './product-photo.input.js';

@Injectable()
export class ProductPhotoService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(CatalogueWrites) private readonly writes: CatalogueWrites,
  ) {}

  async read(idValue: string, manager: boolean) {
    const id = uuidInput(idValue);
    let row: { content: Buffer; mime_type: string } | undefined;
    try {
      const result = await this.database.connectionPool.query<{
        content: Buffer;
        mime_type: string;
      }>(
        'SELECT photo.content, photo.mime_type FROM catalogue_product_photo photo JOIN catalogue_product p ON p.id=photo.product_id WHERE p.id=$1 AND (p.active OR $2)',
        [id, manager],
      );
      row = result.rows[0];
    } catch {
      throw new ServiceUnavailableException(
        'Product photo is temporarily unavailable',
      );
    }
    if (!row) throw new NotFoundException('Product photo not found');
    return row;
  }

  save(actor: CatalogueActor, idValue: string, value: unknown) {
    const id = uuidInput(idValue),
      command = commandInput(value),
      body = objectInput(value);
    const revision = revisionInput(body.revision),
      photo = photoInput(body.photo);
    return this.writes.execute(
      actor,
      command,
      { action: 'product.photo', id, revision, photo, reason: command.reason },
      async (client) => {
        const row = (
          await client.query<{ revision: number }>(
            'SELECT revision FROM catalogue_product WHERE id=$1 FOR UPDATE',
            [id],
          )
        ).rows[0];
        if (!row) throw new NotFoundException('Product not found');
        if (row.revision !== revision)
          throw new ConflictException(
            'This product changed. Reload before editing.',
          );
        if (photo)
          await client.query(
            'INSERT INTO catalogue_product_photo (product_id, content, mime_type) VALUES ($1,$2,$3) ON CONFLICT (product_id) DO UPDATE SET content=EXCLUDED.content, mime_type=EXCLUDED.mime_type',
            [id, photo.content, photo.mimeType],
          );
        else
          await client.query(
            'DELETE FROM catalogue_product_photo WHERE product_id=$1',
            [id],
          );
        await client.query(
          'UPDATE catalogue_product SET revision=revision+1, updated_at=now() WHERE id=$1',
          [id],
        );
        const product = await readProduct(client, id);
        await recordHistory(client, actor, command.reason, 'product', product);
        return { product };
      },
    );
  }
}
