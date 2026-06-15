import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { Subject } from 'rxjs';
import { randomUUID } from 'crypto';

export interface SseEvent {
  type: 'transaction' | 'user' | 'kyc' | 'ping';
  payload?: Record<string, any>;
}

const TICKET_TTL_MS = 60_000; // 60 secondes — assez pour ouvrir EventSource

@Injectable()
export class SseService {
  private readonly events$ = new Subject<SseEvent>();

  // Tickets opaques à usage unique : évite de faire transiter le JWT dans l'URL.
  // L'URL SSE est enregistrée dans les logs serveur, l'historique browser, et les
  // headers Referer — un JWT long-lived dans l'URL est un vecteur de fuite majeur.
  private readonly tickets = new Map<string, { userId: string; expiresAt: number }>();

  get stream() { return this.events$.asObservable(); }

  emit(event: SseEvent) { this.events$.next(event); }

  /** Crée un ticket opaque à usage unique valide 60 secondes. */
  createTicket(userId: string): string {
    const ticket = randomUUID();
    this.tickets.set(ticket, { userId, expiresAt: Date.now() + TICKET_TTL_MS });
    // Nettoyage paresseux des tickets expirés (pas de timer dédié).
    this.pruneExpiredTickets();
    return ticket;
  }

  /**
   * Valide et consomme un ticket (single-use). Retourne l'userId ou null si
   * le ticket est inconnu, expiré ou a déjà été consommé.
   */
  consumeTicket(ticket: string): string | null {
    const entry = this.tickets.get(ticket);
    if (!entry || entry.expiresAt < Date.now()) {
      this.tickets.delete(ticket);
      return null;
    }
    this.tickets.delete(ticket); // Consommation immédiate — usage unique
    return entry.userId;
  }

  private pruneExpiredTickets() {
    const now = Date.now();
    for (const [k, v] of this.tickets) {
      if (v.expiresAt < now) this.tickets.delete(k);
    }
  }

  @OnEvent('transaction.created')
  onTransaction(payload: any) { this.emit({ type: 'transaction', payload }); }

  @OnEvent('user.registered')
  onUser(payload: any) { this.emit({ type: 'user', payload }); }

  @OnEvent('kyc.submitted')
  onKyc(payload: any) { this.emit({ type: 'kyc', payload }); }
}
