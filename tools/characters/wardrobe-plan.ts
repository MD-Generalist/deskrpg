/** Single source for which defective wardrobe nodes each office look loses and which fitted templates it gains. */
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { OFFICE_LOOKS, type OfficeLook } from "../../src/game/three/office-looks";

export type Template =
  "scarf" | "bow" | "backpack" | "shoulder_bag" | "shirt_collar" | "shirt_v" | "lapel" | "vest_v";
export type WardrobePlan = {
  id: string;
  body: "male" | "female";
  remove: string[];
  add: Template[];
  skirt: string | null;
};

const TAILORED = new Set(["suit", "double-breasted", "coat", "labcoat"]);

/** Male looks the old builder gave a `Turtleneck` node (build_male_catalog.py: the turtleneck
 * neckwear, plus office-jin). The turtleneck already closes the neck, so no shirt collar. */
export function hasMaleTurtleneck(look: OfficeLook): boolean {
  return look.bodyType === "male" && (look.neckwear === "turtleneck" || look.id === "office-jin");
}

export function planFor(look: OfficeLook): WardrobePlan {
  const male = look.bodyType === "male";
  const id = look.id;
  const remove: string[] = [];
  const add: Template[] = [];
  const outfit = look.outfit;
  if (male) {
    if (outfit !== "hoodie") {
      remove.push("Collar");
      if (!hasMaleTurtleneck(look)) add.push("shirt_collar");
    }
    if (TAILORED.has(outfit) || outfit === "vest") {
      remove.push("Shirt inset");
      add.push("shirt_v");
    }
    if (TAILORED.has(outfit) || outfit === "vest") {
      remove.push("Tailored lapel");
      if (outfit !== "vest") add.push("lapel");
    }
    if (outfit === "vest") {
      remove.push("Vest V neck");
      add.push("vest_v");
    }
    if (look.bag === "backpack") {
      remove.push("Backpack", "Backpack strap");
      add.push("backpack");
    }
    if (look.bag === "shoulder") {
      remove.push("Shoulder satchel", "Shoulder strap");
      add.push("shoulder_bag");
    }
  } else {
    if (TAILORED.has(outfit)) {
      remove.push(`${id}_Lapel`);
      add.push("lapel");
    }
    if (look.neckwear === "scarf" || look.neckwear === "bow") {
      remove.push(`${id}_${look.neckwear}`, `${id}_Neckwear`);
      add.push(look.neckwear);
    }
    if (look.bag === "backpack") {
      remove.push(`${id}_Backpack`, `${id}_BackpackStrap`);
      add.push("backpack");
    }
    if (look.bag === "shoulder") {
      remove.push(`${id}_ShoulderBag`, `${id}_BagStrap`);
      add.push("shoulder_bag");
    }
  }
  const skirt = !male && look.lower === "skirt" ? `${id}_ContinuousSkirt` : null;
  return { id, body: look.bodyType, remove: [...new Set(remove)], add, skirt };
}

export function isRemoved(plan: WardrobePlan, nodeName: string): boolean {
  return plan.remove.includes(nodeName.replace(/\.\d{3}$/, ""));
}

export function addedNodeName(plan: WardrobePlan, t: Template): string {
  return `${plan.id}_Fit_${t}`;
}

export const ALL_PLANS: WardrobePlan[] = OFFICE_LOOKS.map(planFor);

const jsonFlag = process.argv.indexOf("--json");
if (jsonFlag > 0) {
  const out = process.argv[jsonFlag + 1];
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(ALL_PLANS, null, 2) + "\n");
}
