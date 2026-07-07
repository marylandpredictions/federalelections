import { normalizeRating, ratingsPriorFromRating } from "../shared/v4-core.mjs";

export function buildHouseRatingsPriorV4(rating, sourceCount = 1) {
  return ratingsPriorFromRating(normalizeRating(rating), sourceCount);
}
