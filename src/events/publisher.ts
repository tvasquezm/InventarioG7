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
  payload: TPayload;
}

export class Publisher {

  publish<TPayload>(
    event: InventoryEvent<TPayload>
  ): void {

    console.log("======================================");
    console.log(" Inventory Event Published");
    console.log("======================================");
    console.log(JSON.stringify(event, null, 2));
    console.log("======================================");

  }

  publishReservationCreated(
    reservation: Reservation
  ): void {

    this.publish({
      eventId: crypto.randomUUID(),
      eventType: "inventory.reserved",
      occurredAt: new Date().toISOString(),
      payload: {
        reservationId: reservation.reservationId,
        orderId: reservation.orderId,
        status: reservation.status,
        items: reservation.items,
        expiresAt: reservation.expiresAt
      }
    });

  }

  publishReservationConfirmed(
    reservation: Reservation
  ): void {

    this.publish({
      eventId: crypto.randomUUID(),
      eventType: "inventory.confirmed",
      occurredAt: new Date().toISOString(),
      payload: {
        reservationId: reservation.reservationId,
        orderId: reservation.orderId,
        status: reservation.status,
        items: reservation.items
      }
    });

  }

  publishReservationReleased(
    reservation: Reservation
  ): void {

    this.publish({
      eventId: crypto.randomUUID(),
      eventType: "inventory.released",
      occurredAt: new Date().toISOString(),
      payload: {
        reservationId: reservation.reservationId,
        orderId: reservation.orderId,
        status: reservation.status,
        items: reservation.items
      }
    });

  }

}

export const publisher = new Publisher();