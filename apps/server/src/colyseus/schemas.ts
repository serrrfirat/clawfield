import { Schema, MapSchema, defineTypes } from "@colyseus/schema";

export class PlayerSchema extends Schema {
  name: string = "";
  x: number = 0;
  y: number = 0;
  z: number = 0;
  yaw: number = 0;
  pitch: number = 0;
  health: number = 100;
  alive: boolean = true;
  downed: boolean = false;
  grounded: boolean = true;
  inWater: boolean = false;
  reloading: boolean = false;
  shooting: boolean = false;
  team: number = 0;
  classId: string = "assault";
  ammo: number = 30;
  maxAmmo: number = 30;
  weaponSlot: number = 0;
  weaponName: string = "";
  suppression: number = 0;
  flash: number = 0;
}

defineTypes(PlayerSchema, {
  name: "string",
  x: "float32",
  y: "float32",
  z: "float32",
  yaw: "float32",
  pitch: "float32",
  health: "uint8",
  alive: "boolean",
  downed: "boolean",
  grounded: "boolean",
  inWater: "boolean",
  reloading: "boolean",
  shooting: "boolean",
  team: "uint8",
  classId: "string",
  ammo: "uint16",
  maxAmmo: "uint16",
  weaponSlot: "uint8",
  weaponName: "string",
  suppression: "float32",
  flash: "float32",
});

export class CapturePointSchema extends Schema {
  x: number = 0;
  y: number = 0;
  z: number = 0;
  control: number = 0.5;
  owner: number = -1;
  contested: boolean = false;
}

defineTypes(CapturePointSchema, {
  x: "float32",
  y: "float32",
  z: "float32",
  control: "float32",
  owner: "int8",
  contested: "boolean",
});

export class GameState extends Schema {
  players = new MapSchema<PlayerSchema>();
  capturePoints = new MapSchema<CapturePointSchema>();
  tick: number = 0;
  scoreAlpha: number = 0;
  scoreBravo: number = 0;
  ticketsAlpha: number = 0;
  ticketsBravo: number = 0;
}

defineTypes(GameState, {
  players: { map: PlayerSchema },
  capturePoints: { map: CapturePointSchema },
  tick: "uint32",
  scoreAlpha: "int32",
  scoreBravo: "int32",
  ticketsAlpha: "int32",
  ticketsBravo: "int32",
});
