import { redirect } from "next/navigation";
import { currentUser, homeFor } from "@/server/session";

export default async function Home() {
  redirect(homeFor(await currentUser()));
}
