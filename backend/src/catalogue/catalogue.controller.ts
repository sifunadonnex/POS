import {
  Body,
  Controller,
  Get,
  Header,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  Req,
  StreamableFile,
} from '@nestjs/common';
import { StaffRoles } from '../identity/access.metadata.js';
import type { StaffRequest } from '../identity/staff.guard.js';
import { StoreWrites } from '../store/store-write.metadata.js';
import { CatalogueService } from './catalogue.service.js';
import { CatalogueImportService } from './catalogue-import.service.js';
import { ProductPhotoService } from './product-photo.service.js';

function actor(req: StaffRequest) {
  return { userId: req.staff.user.id, sessionId: req.staff.session.id };
}

@Controller('api/catalogue')
@StoreWrites('central')
export class CatalogueController {
  constructor(
    @Inject(CatalogueService) private readonly catalogue: CatalogueService,
    @Inject(CatalogueImportService)
    private readonly importer: CatalogueImportService,
    @Inject(ProductPhotoService) private readonly photos: ProductPhotoService,
  ) {}

  @Get('categories') categories() {
    return this.catalogue.categories();
  }
  @Get('products') products(
    @Req() req: StaffRequest,
    @Query() query: Record<string, unknown>,
  ) {
    return this.catalogue.products(query, req.staff.user.role === 'manager');
  }
  @Get('products/by-barcode') barcode(@Query('code') code: unknown) {
    return this.catalogue.barcode(code);
  }
  @Get('products/:id/history')
  @StaffRoles('manager')
  history(@Param('id') id: string, @Query('page') page: unknown) {
    return this.catalogue.history(id, page);
  }
  @Get('products/:id/photo')
  @Header('Cache-Control', 'no-store')
  @Header('X-Content-Type-Options', 'nosniff')
  async photo(@Req() req: StaffRequest, @Param('id') id: string) {
    const photo = await this.photos.read(id, req.staff.user.role === 'manager');
    return new StreamableFile(photo.content, {
      type: photo.mime_type,
      disposition: 'inline',
      length: photo.content.length,
    });
  }
  @Post('products/:id/photo')
  @StaffRoles('manager')
  savePhoto(
    @Req() req: StaffRequest,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.photos.save(actor(req), id, body);
  }
  @Post('products')
  @StaffRoles('manager', 'supervisor', 'cashier')
  createProduct(@Req() req: StaffRequest, @Body() body: unknown) {
    return this.catalogue.createProduct(actor(req), body);
  }
  @Patch('products/:id')
  @StaffRoles('manager')
  updateProduct(
    @Req() req: StaffRequest,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.catalogue.updateProduct(actor(req), id, body);
  }
  @Post('categories')
  @StaffRoles('manager')
  createCategory(@Req() req: StaffRequest, @Body() body: unknown) {
    return this.catalogue.saveCategory(actor(req), null, body);
  }
  @Patch('categories/:id')
  @StaffRoles('manager')
  updateCategory(
    @Req() req: StaffRequest,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.catalogue.saveCategory(actor(req), id, body);
  }
  @Post('imports/preview')
  @StaffRoles('manager')
  preview(@Body() body: unknown) {
    return this.importer.preview(body);
  }
  @Post('imports')
  @StaffRoles('manager')
  import(@Req() req: StaffRequest, @Body() body: unknown) {
    return this.importer.import(actor(req), body);
  }
}
