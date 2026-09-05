import { redirect } from "next/navigation";

type Props = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function CoreAliasPage({ searchParams }: Props) {
  const sp = await searchParams;
  const q = new URLSearchParams();
  const c = typeof sp.c === "string" ? sp.c : undefined;
  const note = typeof sp.note === "string" ? sp.note : undefined;
  if (c) q.set("c", c);
  if (note) q.set("note", note);
  redirect(q.toString() ? `/?${q.toString()}` : "/");
}
