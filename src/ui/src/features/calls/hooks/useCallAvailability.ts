import { useCallback, useEffect, useRef, useState } from "react";
import { CallAvailability } from "@uniffy/proto/calls/v1/calls_pb";
import { useAppSelector } from "@/app/hooks";
import { callsApi } from "@/features/calls/api/callsApi";

export function useCallAvailability() {
  const organizationId = useAppSelector((s) => s.auth.currentOrganizationId);
  const [result, setResult] = useState({
    organizationId: "",
    availability: CallAvailability.UNSPECIFIED,
  });
  const generation = useRef(0);
  const mediaProbe = useRef({ organizationId: "", enabled: false });
  const checkAvailability = useCallback(
    async (checkMedia = false) => {
      if (!organizationId) return CallAvailability.UNSPECIFIED;
      mediaProbe.current = {
        organizationId,
        enabled:
          checkMedia ||
          (mediaProbe.current.organizationId === organizationId && mediaProbe.current.enabled),
      };
      const request = ++generation.current;
      let availability: CallAvailability;
      try {
        availability = (
          await callsApi.getCallAvailability({
            organizationId,
            checkMedia: mediaProbe.current.enabled,
          })
        ).availability;
      } catch {
        availability = CallAvailability.UNREACHABLE;
      }
      if (request === generation.current) setResult({ organizationId, availability });
      return availability;
    },
    [organizationId],
  );
  useEffect(() => {
    void checkAvailability();
    const refresh = () => {
      void checkAvailability();
    };
    window.addEventListener("focus", refresh);
    return () => {
      // eslint-disable-next-line react-hooks/exhaustive-deps -- invalidate pending requests, not a DOM ref
      generation.current++;
      window.removeEventListener("focus", refresh);
    };
  }, [checkAvailability]);
  return {
    availability:
      result.organizationId === organizationId ? result.availability : CallAvailability.UNSPECIFIED,
    checkAvailability,
  };
}
