import React from "react";
import { Redirect, useLocalSearchParams } from "expo-router";

// A tag's content lives in the Library now; the old address carries its params over.
export default function TagRedirect() {
  const params = useLocalSearchParams<{ id: string; name?: string }>();
  return <Redirect href={{ pathname: "/library/tags/[id]", params } as any} />;
}
