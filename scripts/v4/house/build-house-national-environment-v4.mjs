import { readJson } from "../shared/v4-core.mjs";

export function buildHouseNationalEnvironmentV4() {
  const house = readJson("data/house-forecast.json", {});
  return {
    source: "data/house-forecast.json",
    status: house.houseNationalEnvironment ? "AVAILABLE_FROM_TRANSITIONAL_SOURCE" : "UNAVAILABLE",
    value: house.houseNationalEnvironment || null,
    usedInV4Publish: false
  };
}
