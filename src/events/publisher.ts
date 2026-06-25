// ======================================================
// Publisher - Mock Event Publisher
// Grupo 7 - Inventory Service
// ======================================================

import crypto from "crypto";
import { Reservation } from "../repository/repository";

export interface InventoryEvent<TPayload = unknown> {
  eventId: string;
  eventType: string;
  occurredAt: string;
  correlationId: string; // <-- AÑADIDO: Requerido por trazabilidad
  payload: TPayload;
}

export class Publisher {

  publish<TPayload>(
    event: InventoryEvent<TPayload>
  ): void {

    console.log("======================================");
    console.log(` 📦 Inventory Event Published: ${event.eventType}`);
    console.log("======================================");
    console.log(JSON.stringify(event, null, 2));
    console.log("======================================");

  }

  // <-- MODIFICADO: Recibe correlationId
  publishReservationCreated(
    correlationId: string,
    reservation: Reservation
  ): void {

    this.publish({
      eventId: crypto.randomUUID(),
      eventType: "inventory.reserved",
      occurredAt: new Date().toISOString(),
      correlationId,
      payload: {
        reservationId: reservation.reservationId,
        orderId: reservation.orderId,
        status: reservation.status,
        items: reservation.items,
        expiresAt: reservation.expiresAt
      }
    });

  }

  // <-- MODIFICADO: Recibe correlationId
  publishReservationConfirmed(
    correlationId: string,
    reservation: Reservation
  ): void {

    this.publish({
      eventId: crypto.randomUUID(),
      eventType: "inventory.confirmed",
      occurredAt: new Date().toISOString(),
      correlationId,
      payload: {
        reservationId: reservation.reservationId,
        orderId: reservation.orderId,
        status: reservation.status,
        items: reservation.items
      }
    });

  }

  // <-- MODIFICADO: Recibe correlationId
  publishReservationReleased(
    correlationId: string,
    reservation: Reservation
  ): void {

    this.publish({
      eventId: crypto.randomUUID(),
      eventType: "inventory.released",
      occurredAt: new Date().toISOString(),
      correlationId,
      payload: {
        reservationId: reservation.reservationId,
        orderId: reservation.orderId,
        status: reservation.status,
        items: reservation.items
      }
    });

  }

  // <-- AÑADIDO: Evento obligatorio de Fase 2 para cancelar ordenes sin stock
  publishStockRejected(
    correlationId: string,
    payload: { orderId: string; reason: string; items: any[] }
  ): void {

    this.publish({
      eventId: crypto.randomUUID(),
      eventType: "inventory.stock_rejected",
      occurredAt: new Date().toISOString(),
      correlationId,
      payload
    });

  }

  // <-- AÑADIDO: Evento obligatorio de Fase 2 para cuando se repone stock manual
  publishStockChanged(
    productId: string,
    inventoryResponse: any,
    correlationId: string
  ): void {

    this.publish({
      eventId: crypto.randomUUID(),
      eventType: "inventory.stock_changed",
      occurredAt: new Date().toISOString(),
      correlationId,
      payload: {
        productId,
        availableStock: inventoryResponse.availableStock,
        reservedStock: inventoryResponse.reservedStock
      }
    });

  }

}

export const publisher = new Publisher();