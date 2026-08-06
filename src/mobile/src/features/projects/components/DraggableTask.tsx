import React from "react";
import { GestureDetector } from "react-native-gesture-handler";
import type { LayoutChangeEvent } from "react-native";
import type { GestureType } from "react-native-gesture-handler";

import { DragShift } from "@features/projects/components/DragShift";

/**
 * A task card that can be picked up, and that slides aside when another card is
 * dragged past it. The lifted card itself goes invisible rather than being
 * unmounted: it keeps its slot, so the cards around it shift over a layout that
 * does not move under the finger.
 */
export function DraggableTask({
  gesture,
  offset,
  animate,
  lifted,
  onLayout,
  onUnmount,
  children,
}: {
  gesture: GestureType;
  offset: number;
  animate: boolean;
  lifted: boolean;
  onLayout: (event: LayoutChangeEvent) => void;
  onUnmount?: () => void;
  children: React.ReactNode;
}) {
  return (
    <GestureDetector gesture={gesture}>
      <DragShift
        offset={offset}
        animate={animate}
        style={lifted ? { opacity: 0 } : undefined}
        onLayout={onLayout}
        onUnmount={onUnmount}
      >
        {children}
      </DragShift>
    </GestureDetector>
  );
}
