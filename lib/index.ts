import axios, { AxiosRequestConfig } from "axios";
import jwt from "jsonwebtoken";
import crypto from "crypto";
import WebSocket from "ws";

import Location, { LocationResponse } from "./location";
import Order, { OrderRetrievalFilters, OrderStatus } from "./order";
import Device, { DeviceResponse, DeviceRegister, DeviceUpdate } from "./device";
import Transaction, {
  TransactionResponse,
  TransactionUpdate,
  TransactionRequest,
  TransactionLogsResponse,
} from "./transaction";
import Webhook, {
  DoshiiEvents,
  WebhookResponse,
  WebhookRegister,
} from "./webhook";
import Booking from "./booking";
import Table from "./table";
import Menu from "./menu";
import Loyalty from "./loyalty";
import Checkin from "./checkin";

import { LogLevel, Logger } from "./utils";

export enum WebSocketEvents {
  ORDER_UPDATED = "order_updated",
  ORDER_CREATED = "order_created",
  TRANSACTION_UPDATED = "transaction_updated",
  BOOKING_CREATED = "booking_created",
  BOOKING_UPDATED = "booking_updated",
  CHECKIN_CREATED = "checkin_created",
  CHECKIN_UPDATED = "ckeckin_updated",
  CHECKIN_DELETED = "checkin_deleted",
  MENU_UPDATED = "menu_updated",
  POINTS_REDEEMED = "points_redemption",
  REWARD_REDEEMED = "reward_redemption",
  TABLE_CREATED = "table_created",
  TABLE_REMOVED = "table_removed",
  TABLE_UPDATED = "table_updated",
  TABLE_BULK_UPDATED = "table_bulk_updated",
  CARD_ACTIVATION_REQUESTED = "card_activate",
  CARD_ENQUIRY_REQUESTED = "card_enquiry",
  ORDER_PREPROCESSED = "order_preprocess",
  LOCATION_SUBSCRIBED = "location_subscription",
  LOCATION_HOURS_UPDATED = "location_hours_updated",
  APP_MENU_UPDATED = "app_menu_updated",
  APP_MENU_ITEM_UPDATED = "app_menu_item_updated",
  LOYALTY_CHECKIN_CREATED = "loyalty_checkin_created",
  LOYALTY_CHECKIN_UPDATED = "loyalty_checkin_updated",
  LOYALTY_CHECKIN_DELETED = "loyalty_checkin_deleted",
  PONG = "pong",
}

export default class Doshii {
  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly sandbox: boolean;
  private readonly url: string;
  private readonly logger: Logger;

  private apiKey = "";

  // websocket and subscribers
  private websocket!: WebSocket;
  private subscribers: Map<
    string,
    { callback: (data: any) => void; events: Array<WebSocketEvents> }
  > = new Map();
  private eventSubscribers: Map<WebSocketEvents, Array<string>> = new Map();

  readonly location: Location;
  readonly order: Order;
  readonly device: Device;
  readonly webhook: Webhook;
  readonly transaction: Transaction;
  readonly booking: Booking;
  readonly table: Table;
  readonly menu: Menu;
  readonly loyalty: Loyalty;
  readonly checkin: Checkin;

  constructor(
    clientId: string,
    clientSecret: string,
    appId?: string,
    sandbox = false,
    apiVersion = 3,
    logLevel = LogLevel.WARN
  ) {
    this.logger = new Logger(logLevel);
    this.clientId = clientId;
    this.clientSecret = clientSecret;
    this.url = sandbox
      ? `https://sandbox.doshii.co/partner/v${apiVersion}`
      : `https://live.doshii.co/partner/v${apiVersion}`;

    this.location = new Location(this.submitRequest.bind(this));
    this.order = new Order(this.submitRequest.bind(this));
    this.device = new Device(this.submitRequest.bind(this));
    this.webhook = new Webhook(this.submitRequest.bind(this));
    this.transaction = new Transaction(this.submitRequest.bind(this));
    this.booking = new Booking(this.submitRequest.bind(this));
    this.table = new Table(this.submitRequest.bind(this));
    this.menu = new Menu(this.submitRequest.bind(this));
    this.loyalty = new Loyalty(this.submitRequest.bind(this));
    this.checkin = new Checkin(this.submitRequest.bind(this));

    this.sandbox = sandbox;

    if (appId) {
      this.generateApiKey(appId);
    }
  }

  private generateApiKey(appId: string) {
    // generate the x-api-key for bulk data requests
    const hasher = crypto.createHmac("sha256", this.clientSecret);
    this.apiKey = `${hasher.update(this.clientId).digest("hex")}:${appId}`;
  }

  protected async submitRequest(data: AxiosRequestConfig) {
    const payload = {
      clientId: this.clientId,
      timestamp: Math.round(Date.now() / 1000),
    };
    try {
      const resp = await axios.request({
        ...data,
        baseURL: this.url,
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${jwt.sign(payload, this.clientSecret)}`,
          ...data.headers,
        },
      });
      return resp.data;
    } catch (error) {
      throw error;
    }
  }

  private websocketSetup(sandbox: boolean) {
    const wsUrl = sandbox
      ? "wss://sandbox-socket.doshii.co/app/socket?auth="
      : "wss://live-socket.doshii.co/app/socket?auth=";
    const auth = Buffer.from(this.clientId).toString("base64");
    // debugging
    // const wsUrl = "wss://echo.websocket.org";
    // const auth = "";
    this.websocket = new WebSocket(wsUrl + auth);

    // send pings every 30s and on open
    this.websocket.onopen = () => {
      this.logger.debug("Doshii: Opened websocket");
      const ping = (autoClose: boolean = false) => {
        if (autoClose && this.subscribers.size < 1) {
          this.logger.info(
            "Doshii: Closing websocket as no subscribers, subscribing to an event will start the websocket automatically"
          );
          this.websocket.close();
          clearInterval(heartbeat);
          return;
        }
        this.logger.debug("Doshii: Sending ping to websocket");
        this.websocket.send(
          JSON.stringify({
            doshii: {
              ping: Date.now(),
              version: "1.2.3",
            },
          })
        );
        this.logger.debug("Doshii: Ping sent to websocket");
      };
      // Send one immediately to complete the handshake
      ping();
      // Then 30 every seconds or so thereafter to keep alive
      const heartbeat = setInterval(ping, 30000, true);
    };

    this.websocket.onmessage = (event: any) => {
      this.onWebsocketMessage(event);
    };

    this.websocket.onerror = (event: any) => {
      this.onWebsocketError(event);
    };

    this.websocket.onclose = () => {
      this.onWebsocketClose();
    };
  }

  private onWebsocketMessage(event: any) {
    this.logger.debug("Doshii: Recieved message from websocket");
    const eventData = JSON.parse(event.data);
    if (eventData?.doshii?.pong) {
      this.logger.debug("Doshii: Got pong");
      this.notifySubscribers(WebSocketEvents.PONG, eventData);
      return;
    }
    const eventType = eventData.emit[0];
    const eventPayload = eventData.emit[1];
    this.notifySubscribers(eventType, eventPayload);
  }

  private notifySubscribers(event: WebSocketEvents, data: any) {
    // get subscribers for the event
    if (!this.eventSubscribers.has(event)) return;
    const subscribers = this.eventSubscribers.get(event);

    if (!subscribers || !subscribers.length) {
      this.eventSubscribers.delete(event);
      return;
    }

    // get callback func for each subscriber and exec
    for (const subscriber of subscribers) {
      if (!this.subscribers.has(subscriber)) continue;
      const { callback } = this.subscribers.get(subscriber)!;
      if (!callback || event.length < 1) {
        this.subscribers.delete(subscriber);
      }
      try {
        callback(data);
      } catch (error) {
        this.logger.error(
          `Doshii: Error while executing callback for subscriber ${subscriber}`
        );
        this.logger.error(error);
      }
    }
  }

  private onWebsocketError(event: any) {
    this.logger.warn(
      `Doshii: Recieved error from websocket - ${JSON.stringify(event.data)}`
    );
  }

  private onWebsocketClose() {
    this.logger.warn("Doshii: Websocket closed ");
  }

  /**
   * Subscribe to websocket events
   * @param events Events to subscribe to
   * @param callback Callback function to invoke
   * @returns subscriber ID
   */
  subscribeToWebsockeEvents(
    events: Array<WebSocketEvents>,
    callback: (data: any) => void
  ) {
    // If first subscriber start websocket
    if (this.subscribers.size < 1) {
      this.websocketSetup(this.sandbox);
    }
    // Add to subscribers map
    const subscriberId = Date.now().toString(36);
    this.subscribers.set(subscriberId, { callback: callback, events: events });

    // add to eventSubscribers map
    for (const event of events) {
      if (this.eventSubscribers.has(event)) {
        // if there are other subscribers to this event
        // append to the subscriber list
        const subscribers = this.eventSubscribers.get(event);
        if (!subscribers || !subscribers.length) {
          this.eventSubscribers.set(event, [subscriberId]);
        }
        this.eventSubscribers.set(event, subscribers!.concat(subscriberId));
      } else {
        this.eventSubscribers.set(event, [subscriberId]);
      }
    }
    return subscriberId;
  }

  /**
   * Unsubscribe a subscriber from websocket events
   * @param subscriberId subscriber to unsubscribe
   * @param events Events to unsubscribe from. Although optional,
   * it is recommended to provide this for performance reasons.
   * If undefined the subscriber is unsubscribed from all events
   */
  unsubscribeFromWebsocketEvents(
    subscriberId: string,
    events?: Array<WebSocketEvents>
  ) {
    if (!this.subscribers.has(subscriberId)) {
      throw new Error("Doshii: Invalid subscriber ID");
    }

    if (events) {
      // remove this subscriber from the eventSubscriber map
      for (const event of events) {
        if (!this.eventSubscribers.has(event)) continue;
        // keep all other subscribers except for the one
        // that we need to remove
        let subscribers = this.eventSubscribers.get(event);
        if (!subscribers || !subscribers.length) {
          // delete the empty event
          this.eventSubscribers.delete(event);
          continue;
        }
        const indexToRemove = subscribers.indexOf(subscriberId);
        if (indexToRemove > -1) {
          subscribers.splice(indexToRemove, 1);
        }
        this.eventSubscribers.set(event, subscribers);
      }
      // remove this event from the subscriber map
      const cbAndEvents = this.subscribers.get(subscriberId);
      const _events = cbAndEvents!.events.filter(
        (event) => !events.includes(event)
      );
      if (!_events.length) {
        // if not subscribed to any
        // event delete the subscriber
        this.subscribers.delete(subscriberId);
      } else {
        // update event list for the subscriber
        this.subscribers.set(subscriberId, {
          ...cbAndEvents!,
          events: _events,
        });
      }
    } else {
      // loop thru all the events and remove this subscriber
      this.eventSubscribers.forEach((subscribers, event) => {
        const indexToDelete = subscribers.indexOf(subscriberId);
        if (indexToDelete < 0) {
          return;
        }
        subscribers.splice(indexToDelete, 1);
        if (!subscribers.length) {
          this.eventSubscribers.delete(event);
        } else {
          this.eventSubscribers.set(event, subscribers);
        }
      });
      // remove subscriber from subscribers map
      this.subscribers.delete(subscriberId);
    }
  }

  /**
   * Clear all websocket subscriptions
   */
  clearAllWebsocketSubscriptions() {
    this.eventSubscribers.clear();
    this.subscribers.clear();
  }

  /**
   * Retrieve all rejection codes
   * @returns List of all rejection codes
   */
  async getRejectionCodes(code: string) {
    return this.submitRequest({
      url: code ? `/rejection_codes/${code}` : "/rejection_codes",
      method: "GET",
    });
  }

  /**
   *
   * Submit an asynchronous data aggregation request.
   * @param dataset The dataset that was requested to be aggregated. Current supported value is orders.
   * @param appId required if not provided during class instantiation else not required
   * @returns The registered bulk data request
   */
  requestBulkDataAggregation(dataset = "orders", appId?: string) {
    if (!this.apiKey) {
      if (!appId) {
        throw new Error(
          "Doshii: appId is required as Doshii class was instantiated without it"
        );
      }
      this.generateApiKey(appId);
    }

    return this.submitRequest({
      url: `/data/${dataset}`,
      method: "POST",
      headers: {
        "X-API-KEY": this.apiKey,
      },
    });
  }

  /**
   * Retrieve the current status of a previously submitted data aggregation request.
   * @param requestId Unique ID identifying this request.
   * @param dataset The dataset that was requested to be aggregated. Current supported value is orders.
   * @param appId required if not provided during class instantiation else not required
   * @returns The registered bulk data request
   */
  getBulkDataAggregationStatus(
    requestId: string,
    dataset = "orders",
    appId?: string
  ) {
    if (!this.apiKey) {
      if (!appId) {
        throw new Error(
          "Doshii: appId is required as Doshii class was instantiated without it"
        );
      }
      this.generateApiKey(appId);
    }

    return this.submitRequest({
      url: `/data/${dataset}/${requestId}`,
      method: "GET",
      headers: {
        "X-API-KEY": this.apiKey,
      },
    });
  }
}

export {
  OrderStatus,
  OrderRetrievalFilters,
  LogLevel,
  DoshiiEvents,
  DeviceRegister,
  DeviceUpdate,
  DeviceResponse,
  LocationResponse,
  WebhookResponse,
  WebhookRegister,
  TransactionResponse,
  TransactionUpdate,
  TransactionRequest,
  TransactionLogsResponse,
};
