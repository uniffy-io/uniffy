import { ThumbsUp, HandsClapping, Heart, Confetti } from "@phosphor-icons/react";
import { CallReaction } from "@uniffy/proto/calls/v1/calls_pb";

export const callReactions = [
  { value: CallReaction.AGREE, label: "Agree", Icon: ThumbsUp },
  { value: CallReaction.APPLAUSE, label: "Applause", Icon: HandsClapping },
  { value: CallReaction.LOVE, label: "Love", Icon: Heart },
  { value: CallReaction.CELEBRATE, label: "Celebrate", Icon: Confetti },
];
