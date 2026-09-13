import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { ACCESS_COOKIE, accessIsArmed, cookieIsValid } from "@/lib/web-access";
import { Chat } from "./chat";

// The shell is gated here so an unauthenticated visitor lands on the login form
// instead of a chat that answers every send with a raw 401 body.
export default async function Page() {
  const store = await cookies();
  if (accessIsArmed() && !cookieIsValid(store.get(ACCESS_COOKIE)?.value)) redirect("/login");

  return <Chat />;
}
