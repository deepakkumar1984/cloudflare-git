import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { DEFAULT_APP_NAME } from "@shared/constants";

type AppMeta = {
  appName: string;
  signupOpen: boolean;
};

async function loadAppMeta(): Promise<AppMeta> {
  const response = await fetch("/api/meta");
  if (!response.ok) throw new Error("Could not load app settings");
  const body = (await response.json()) as Partial<AppMeta>;
  const appName = body.appName?.trim();
  if (!appName) throw new Error("App name is missing");
  return { appName, signupOpen: body.signupOpen !== false };
}

export function useAppMeta(): AppMeta {
  const query = useQuery({
    queryKey: ["meta"],
    queryFn: loadAppMeta,
    staleTime: Infinity,
  });
  const appName = query.data?.appName || DEFAULT_APP_NAME;

  useEffect(() => {
    document.title = appName;
  }, [appName]);

  return { appName, signupOpen: query.data?.signupOpen !== false };
}

export function useAppName(): string {
  return useAppMeta().appName;
}
