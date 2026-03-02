"use client";

import { type ReactNode, useEffect } from "react";
import { Provider } from "react-redux";
import { SessionProvider, useSession } from "next-auth/react";
import { store } from "@/lib/store/store";
import { clearLoggedUser, setLoggedUser } from "@/lib/store/slices/auth-slice";
import { useAppDispatch } from "@/lib/store/hooks";

function AuthSessionSync() {
  const dispatch = useAppDispatch();
  const { data: session, status } = useSession();

  useEffect(() => {
    if (status === "authenticated" && session?.user?.email) {
      dispatch(
        setLoggedUser({
          email: session.user.email,
          name: session.user.name ?? null,
        }),
      );
      return;
    }

    if (status === "unauthenticated") {
      dispatch(clearLoggedUser());
    }
  }, [dispatch, session?.user?.email, session?.user?.name, status]);

  return null;
}

interface AppProvidersProps {
  children: ReactNode;
}

export function AppProviders({ children }: AppProvidersProps) {
  return (
    <Provider store={store}>
      <SessionProvider>
        <AuthSessionSync />
        {children}
      </SessionProvider>
    </Provider>
  );
}
