import { ArraySchema, Schema, type } from "@colyseus/schema";
import type { BellPhase } from "../bell.js";

export class LanternState extends Schema {
  @type("string") id = "";
  @type("float32") x = 0;
  @type("float32") z = 0;
  @type("float64") litUntil = 0;
}

export class BellState extends Schema {
  @type("string") phase: BellPhase = "waiting";
  @type("uint32") roundId = 0;
  @type("float64") endsAt = 0;
  @type("float64") updatedAt = 0;
  @type("float32") charge = 0;
  @type("boolean") won = false;
  @type([LanternState]) lanterns = new ArraySchema<LanternState>();
}
