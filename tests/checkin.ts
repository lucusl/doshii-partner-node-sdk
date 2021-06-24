import Doshii from "../lib";
import axios from "axios";
import jwt from "jsonwebtoken";
import {
  sampleCheckinRequest,
  sampleCheckinResponse,
  sampleOrderResponse,
} from "./sharedSamples";

jest.mock("axios");
jest.mock("jsonwebtoken");

describe("Booking", () => {
  let doshii: Doshii;
  const locationId = "some0Location5Id9";
  const clientId = "some23Clients30edID";
  const checkinId = "chekc34idje9";
  const clientSecret = "su234perDu[erse-898cret-09";
  let authSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    doshii = new Doshii(clientId, clientSecret, "", true);
    authSpy = jest.spyOn(jwt, "sign").mockImplementation(() => "signedJwt");
  });

  test("Should request for all checkins with or without filters", async () => {
    const requestSpy = jest
      .spyOn(axios, "request")
      .mockResolvedValue({ status: 200, data: [sampleCheckinResponse] });
    await expect(doshii.checkin.getAll(locationId)).resolves.toMatchObject([
      sampleCheckinResponse,
    ]);
    expect(requestSpy).toBeCalledWith({
      headers: {
        "doshii-location-id": locationId,
        authorization: "Bearer signedJwt",
        "content-type": "application/json",
      },
      method: "GET",
      baseURL: "https://sandbox.doshii.co/partner/v3",
      url: "/checkins",
    });

    expect(authSpy).toBeCalledTimes(1);
  });

  test("Should request for a specific checkin", async () => {
    const requestSpy = jest
      .spyOn(axios, "request")
      .mockResolvedValue({ status: 200, data: sampleCheckinResponse });
    await expect(
      doshii.checkin.getOne(locationId, checkinId)
    ).resolves.toMatchObject(sampleCheckinResponse);
    expect(requestSpy).toBeCalledWith({
      headers: {
        "doshii-location-id": locationId,
        authorization: "Bearer signedJwt",
        "content-type": "application/json",
      },
      method: "GET",
      baseURL: "https://sandbox.doshii.co/partner/v3",
      url: `/checkins/${checkinId}`,
    });
    expect(authSpy).toBeCalledTimes(1);
  });

  test("Should pass on the filters as params for retrieving checkins", async () => {
    const requestSpy = jest
      .spyOn(axios, "request")
      .mockResolvedValue({ status: 200, data: [sampleCheckinResponse] });
    await expect(
      doshii.checkin.getAll(locationId, {
        from: new Date("01-01-2021"),
        to: new Date("01-02-2021"),
        updatedFrom: new Date("01-01-2021"),
        updatedTo: new Date("01-02-2021"),
        offset: 2,
        limit: 100,
      })
    ).resolves.toMatchObject([sampleCheckinResponse]);
    expect(requestSpy).toBeCalledWith({
      headers: {
        "doshii-location-id": locationId,
        authorization: "Bearer signedJwt",
        "content-type": "application/json",
      },
      method: "GET",
      baseURL: "https://sandbox.doshii.co/partner/v3",
      url: `/checkins`,
      params: {
        from: 1609419600,
        limit: 100,
        offset: 2,
        to: 1609506000,
        updatedFrom: 1609419600,
        updatedTo: 1609506000,
      },
    });
  });

  test("Should reject the promise if request fails", async () => {
    jest
      .spyOn(axios, "request")
      .mockRejectedValue({ status: 500, error: "failed" });
    await expect(doshii.checkin.get(locationId)).rejects.toBeDefined();
  });

  test("Should request for checkin orders", async () => {
    const requestSpy = jest
      .spyOn(axios, "request")
      .mockResolvedValue({ status: 200, data: [sampleOrderResponse] });
    await expect(
      doshii.checkin.getOrders(locationId, checkinId)
    ).resolves.toMatchObject([sampleOrderResponse]);
    expect(requestSpy).toBeCalledWith({
      headers: {
        "doshii-location-id": locationId,
        authorization: "Bearer signedJwt",
        "content-type": "application/json",
      },
      method: "GET",
      baseURL: "https://sandbox.doshii.co/partner/v3",
      url: `/checkins/${checkinId}/orders`,
    });
  });

  test("Should request new checkin", async () => {
    const requestSpy = jest
      .spyOn(axios, "request")
      .mockResolvedValue({ status: 200, data: sampleCheckinResponse });
    await expect(
      doshii.checkin.create(locationId, sampleCheckinRequest)
    ).resolves.toMatchObject(sampleCheckinResponse);
    expect(requestSpy).toBeCalledWith({
      headers: {
        "doshii-location-id": locationId,
        authorization: "Bearer signedJwt",
        "content-type": "application/json",
      },
      method: "POST",
      baseURL: "https://sandbox.doshii.co/partner/v3",
      url: `/checkins`,
      data: sampleCheckinRequest,
    });
  });

  test("Should request for checkin update", async () => {
    const requestSpy = jest
      .spyOn(axios, "request")
      .mockResolvedValue({ status: 200, data: sampleCheckinResponse });
    await expect(
      doshii.checkin.update(locationId, checkinId, sampleCheckinRequest)
    ).resolves.toBeDefined();
    expect(requestSpy).toBeCalledWith({
      headers: {
        "doshii-location-id": locationId,
        authorization: "Bearer signedJwt",
        "content-type": "application/json",
      },
      method: "PUT",
      baseURL: "https://sandbox.doshii.co/partner/v3",
      url: `/checkins/${checkinId}`,
      data: sampleCheckinRequest,
    });
  });
});
