import React from "react";
import { View } from "react-native";
import { GestureDetector } from "react-native-gesture-handler";
import type { LayoutChangeEvent } from "react-native";
import type { GestureType } from "react-native-gesture-handler";

import { DragShift } from "@features/projects/components/DragShift";

/**
 * A task card that can be picked up, and that slides aside when another card is
 * dragged past it. The lifted card itself goes invisible rather than being
 * unmounted: it keeps its slot, so the cards around it shift over a layout that
 * does not move under the finger.
 *
 * `trailing` renders below the card inside the same measured block, so it moves
 * and hides with the card, but a long press on it does not pick anything up.
 */
export function DraggableTask({
  gesture,
  offset,
  animate,
  lifted,
  onLayout,
  onUnmount,
  trailing,
  children,
}: {
  gesture: GestureType;
  offset: number;
  animate: boolean;
  lifted: boolean;
  onLayout: (event: LayoutChangeEvent) => void;
  onUnmount?: () => void;
  trailing?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <DragShift
      offset={offset}
      animate={animate}
      style={lifted ? { opacity: 0 } : undefined}
      onLayout={onLayout}
      onUnmount={onUnmount}
    >
      <GestureDetector gesture={gesture}>
        <View collapsable={false}>{children}</View>
      </GestureDetector>
      {trailing}
    </DragShift>
  );
}
