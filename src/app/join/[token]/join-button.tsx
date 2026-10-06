"use client";

import { Button, ErrorNote } from "@/components/ui";
import { useCommand } from "@/components/use-command";

export function JoinButton({ token }: { token: string }) {
  const { run, pending, error } = useCommand();
  return (
    <div className="flex flex-col gap-3">
      <ErrorNote message={error?.message} />
      <Button
        variant="primary"
        disabled={pending}
        onClick={async () => {
          const r = await run("JoinHousehold", { token }, { refresh: false });
          if (r) window.location.href = "/today";
        }}
      >
        Join
      </Button>
    </div>
  );
}
