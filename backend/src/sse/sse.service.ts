import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { Subject } from 'rxjs';

export interface SseEvent {
  type: 'transaction' | 'user' | 'kyc' | 'ping';
  payload?: Record<string, any>;
}

@Injectable()
export class SseService {
  private readonly events$ = new Subject<SseEvent>();

  get stream() { return this.events$.asObservable(); }

  emit(event: SseEvent) { this.events$.next(event); }

  @OnEvent('transaction.created')
  onTransaction(payload: any) { this.emit({ type: 'transaction', payload }); }

  @OnEvent('user.registered')
  onUser(payload: any) { this.emit({ type: 'user', payload }); }

  @OnEvent('kyc.submitted')
  onKyc(payload: any) { this.emit({ type: 'kyc', payload }); }
}
