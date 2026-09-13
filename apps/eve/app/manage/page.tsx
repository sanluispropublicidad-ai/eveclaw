import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { ACCESS_COOKIE, accessIsArmed, cookieIsValid } from "@/lib/web-access";
import { Chat } from "../chat";

// The manage view renders inside the chat shell so the thread sidebar is
// shared; ChatApp keeps the URL in sync ("/" vs "/manage") via pushState.
// Gated like the root page: same cookie, same door.

export default async function ManagePage() {
  const store = await cookies();
  if (accessIsArmed() && !cookieIsValid(store.get(ACCESS_COOKIE)?.value)) redirect("/login");

  return <Chat initialView="manage" />;
}
