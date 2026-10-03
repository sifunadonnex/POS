import { SetMetadata } from '@nestjs/common';

export const STORE_WRITE_SCOPE = 'paygo:store-write-scope';
export type StoreWriteScope = 'central' | 'operational';

export const StoreWrites = (scope: StoreWriteScope) =>
  SetMetadata(STORE_WRITE_SCOPE, scope);
