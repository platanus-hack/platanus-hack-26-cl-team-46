import { Module } from '@nestjs/common';
import { RenderModule } from '../render/render.module.js';
import { DeployWatcher } from './deploy-watcher.js';

/** Deploy automático desde el repo de Platanus Hack (ver DeployWatcher). */
@Module({
  imports: [RenderModule],
  providers: [DeployWatcher],
})
export class DeployWatcherModule {}
