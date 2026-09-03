import React from "react";
import { Redirect } from "expo-router";

// The bookmarks live in the Library now; the old address still lands there.
export default function BookmarksRedirect() {
  return <Redirect href={"/library" as any} />;
}
