import { useEffect, useState } from "react";
import type { DriveUserProfile } from "@/lib/googleDrive/driveClient";
import { getCachedGoogleDriveToken } from "@/lib/googleDrive/identity";
import { verifyAndActivateGoogleDriveSession } from "@/lib/googleDrive/accountSession";
import { clearActiveGoogleAccount } from "@/lib/sync/accountContext";

const PROFILE_STORAGE_KEY = "myvault-google-drive-profile";

export function useGoogleDriveProfile() {
  // Never paint a cached profile before its current token has proved identity.
  const [profile, setProfile] = useState<DriveUserProfile | null>(null);

  useEffect(() => {
    let cancelled = false;
    const refreshProfile = () => {
      const token = getCachedGoogleDriveToken();
      if (!token) {
        localStorage.removeItem(PROFILE_STORAGE_KEY);
        clearActiveGoogleAccount();
        setProfile(null);
        return;
      }

      setProfile(null);
      void verifyAndActivateGoogleDriveSession(token)
        .then(({ profile: nextProfile }) => {
          if (cancelled) return;
          localStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(nextProfile));
          setProfile(nextProfile);
        })
        .catch(() => undefined);
    };

    refreshProfile();
    window.addEventListener("myvault-google-drive-session-changed", refreshProfile);

    return () => {
      cancelled = true;
      window.removeEventListener("myvault-google-drive-session-changed", refreshProfile);
    };
  }, []);

  return profile;
}
