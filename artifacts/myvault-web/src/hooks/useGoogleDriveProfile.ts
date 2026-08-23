import { useEffect, useState } from "react";
import { getDriveUserProfile, type DriveUserProfile } from "@/lib/googleDrive/driveClient";
import { getCachedGoogleDriveToken } from "@/lib/googleDrive/identity";

const PROFILE_STORAGE_KEY = "myvault-google-drive-profile";

function readCachedProfile() {
  if (typeof window === "undefined") return null;
  try {
    const value = localStorage.getItem(PROFILE_STORAGE_KEY);
    if (!value) return null;
    const profile = JSON.parse(value) as DriveUserProfile;
    return typeof profile.displayName === "string" || typeof profile.emailAddress === "string" ? profile : null;
  } catch {
    return null;
  }
}

export function useGoogleDriveProfile() {
  const [profile, setProfile] = useState<DriveUserProfile | null>(readCachedProfile);

  useEffect(() => {
    let cancelled = false;
    const refreshProfile = () => {
      const token = getCachedGoogleDriveToken();
      if (!token) {
        localStorage.removeItem(PROFILE_STORAGE_KEY);
        setProfile(null);
        return;
      }

      setProfile(null);
      void getDriveUserProfile(token.accessToken)
        .then((nextProfile) => {
          if (!nextProfile || cancelled) return;
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
