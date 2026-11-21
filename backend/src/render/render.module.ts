import { Module } from '@nestjs/common';
import { RenderClient } from './render.client.js';

@Module({
  providers: [RenderClient],
  exports: [RenderClient],
})
export class RenderModule {}
