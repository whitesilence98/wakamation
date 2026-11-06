import { MapSchema, Schema, type } from "@colyseus/schema";
import { DEFAULT_CHARACTER, DEFAULT_COLOR, DEFAULT_NAME, type CharacterId } from "../social.js";
import type { AnimationName } from "../movement.js";
import { BellState } from "./BellState.js";

export class Player extends Schema {
  @type("uint32") embers = 0;
  @type("uint32") lanternsLit = 0;
  @type("string") name = DEFAULT_NAME;
  @type("string") color = DEFAULT_COLOR;
  @type("string") character: CharacterId = DEFAULT_CHARACTER;
  @type("boolean") speaking = false;
  @type("float32") x = 0;
  @type("float32") y = 0;
  @type("float32") z = 0;
  @type("float32") vy = 0;
  @type("float32") rotation = 0;
  @type("string") currentAnimation: AnimationName = "Idle";
  @type("uint32") lastProcessedSeq = 0;
}

export class GameState extends Schema {
  @type(BellState) bell = new BellState();
  @type({ map: Player }) players = new MapSchema<Player>();
}
