import React from "react";
import { ScreenShareQuality } from "@uniffy/proto/calls/v1/calls_pb";
import { useCall } from "@features/calls/CallContext";
import { useScreenShareQuality } from "@features/calls/callPrefs";
import { SCREEN_SHARE_QUALITY_LABEL, selectableTiers } from "@features/calls/screenShareQuality";
import { BottomSheet } from "@shared/components/BottomSheet";
import { SheetHeader } from "@shared/components/SheetHeader";
import { SheetRow } from "@shared/components/SheetRow";

const TIER_HINT: Record<ScreenShareQuality, string> = {
  [ScreenShareQuality.UNSPECIFIED]: "Follows whatever this organization allows",
  [ScreenShareQuality.BALANCED]: "Easiest on a mobile connection",
  [ScreenShareQuality.HIGH]: "Sharper text, more upload",
  [ScreenShareQuality.MAX]: "Sharpest, needs a strong connection",
};

export function ScreenShareQualitySheet({
  visible,
  onClose,
}: {
  visible: boolean;
  onClose: () => void;
}) {
  const { session } = useCall();
  const [quality, setQuality] = useScreenShareQuality();
  const tiers = [ScreenShareQuality.UNSPECIFIED, ...selectableTiers(session.screenShareQualityCap)];

  return (
    <BottomSheet visible={visible} onClose={onClose}>
      <SheetHeader title="Screen share quality" />
      {tiers.map((tier) => (
        <SheetRow
          key={tier}
          title={SCREEN_SHARE_QUALITY_LABEL[tier]}
          subtitle={TIER_HINT[tier]}
          selected={quality === tier}
          onPress={() => {
            setQuality(tier);
            onClose();
          }}
        />
      ))}
    </BottomSheet>
  );
}
