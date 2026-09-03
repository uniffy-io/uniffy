import React from "react";
import { Redirect } from "expo-router";

// Tags live in the Library now; the old address still lands there.
export default function TagsRedirect() {
  return <Redirect href={"/library/tags" as any} />;
}
