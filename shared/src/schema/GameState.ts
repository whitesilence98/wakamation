import { MapSchema, Schema, type } from "@colyseus/schema";
import type { AnimationName } from "../movement.js";

export class Player extends Schema {
  @type("float32") x = 0;
  @type("float32") y = 0;
  @type("float32") z = 0;
  @type("float32") rotation = 0;
  @type("string") currentAnimation: AnimationName = "Idle";
  @type("uint32") lastProcessedSeq = 0;
}

export class GameState extends Schema {
  @type({ map: Player }) players = new MapSchema<Player>();
}
