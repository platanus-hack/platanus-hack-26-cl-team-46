import { Module } from '@nestjs/common';
import { PreviewController } from './preview.controller.js';

@Module({ controllers: [PreviewController] })
export class PreviewModule {}
