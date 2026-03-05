"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { signOut } from "next-auth/react";
import {
  AlertTriangle,
  Camera,
  KeyRound,
  Loader2,
  Mail,
  Save,
  ShieldCheck,
  UserRound,
} from "lucide-react";
import { toast } from "sonner";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/app/components/ui/card";
import { Button } from "@/app/components/ui/button";
import { Input } from "@/app/components/ui/input";
import { Label } from "@/app/components/ui/label";
import { Textarea } from "@/app/components/ui/textarea";
import { Switch } from "@/app/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/app/components/ui/select";
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@/app/components/ui/avatar";
import { Badge } from "@/app/components/ui/badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/app/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/app/components/ui/dialog";
import { RadioGroup, RadioGroupItem } from "@/app/components/ui/radio-group";
import { useAppDispatch, useAppSelector } from "@/lib/store/hooks";
import {
  fetchTopbarData,
  selectTopbarActiveOrganizationId,
} from "@/lib/store/slices/topbar-slice";
import {
  useManagePasskeys,
  useRegisterPasskey,
} from "next-passkey-webauthn/client";
import type { StoredCredential } from "next-passkey-webauthn/types";
import { passkeyEndpoints } from "@/lib/passkey-endpoints";
import { normalizeAvatarUrl } from "@/lib/avatar-url";

type AvatarSaveMode = "original" | "square_crop" | "square_fit";

type ProfileForm = {
  name: string;
  email: string;
  avatarUrl: string;
  phone: string;
  title: string;
  department: string;
  timezone: string;
  bio: string;
};

type PasswordForm = {
  newPassword: string;
  confirmPassword: string;
};

type PasskeyFactor = StoredCredential;

type ProfileResponse = {
  user: {
    id: string;
    name: string | null;
    email: string;
    avatar_url: string | null;
  };
  profile: {
    phone: string | null;
    title: string | null;
    department: string | null;
    bio: string | null;
    timezone: string | null;
    multiStepAuthEnabled: boolean;
  };
};

const EMPTY_PROFILE_FORM: ProfileForm = {
  name: "",
  email: "",
  avatarUrl: "",
  phone: "",
  title: "",
  department: "",
  timezone: "",
  bio: "",
};

const EMPTY_PASSWORD_FORM: PasswordForm = {
  newPassword: "",
  confirmPassword: "",
};

const COMMON_TIMEZONES = [
  "UTC",
  "Africa/Cairo",
  "Africa/Johannesburg",
  "Europe/London",
  "Europe/Paris",
  "Europe/Berlin",
  "Europe/Madrid",
  "Europe/Rome",
  "Europe/Athens",
  "Europe/Istanbul",
  "Europe/Moscow",
  "Asia/Dubai",
  "Asia/Riyadh",
  "Asia/Karachi",
  "Asia/Kolkata",
  "Asia/Dhaka",
  "Asia/Bangkok",
  "Asia/Singapore",
  "Asia/Hong_Kong",
  "Asia/Tokyo",
  "Asia/Seoul",
  "Australia/Sydney",
  "Australia/Melbourne",
  "Pacific/Auckland",
  "America/St_Johns",
  "America/Halifax",
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Phoenix",
  "America/Los_Angeles",
  "America/Anchorage",
  "Pacific/Honolulu",
  "America/Mexico_City",
  "America/Bogota",
  "America/Lima",
  "America/Santiago",
  "America/Sao_Paulo",
  "America/Argentina/Buenos_Aires",
];

const TIMEZONE_UNSET_VALUE = "__unset__";
const AVATAR_CANVAS_SIZE = 512;

function mapPasskeyErrorMessage(error: unknown): string {
  const rawMessage =
    error instanceof Error ? error.message : "Failed to process passkey request";
  const normalized = rawMessage.toLowerCase();

  if (typeof window !== "undefined" && !window.isSecureContext) {
    return "Passkeys require a secure origin. Use HTTPS (or localhost). On phone, open your HTTPS domain, not a plain HTTP LAN URL.";
  }

  if (normalized.includes("not supported")) {
    return "This browser/device cannot use passkeys for this site. Update browser and ensure secure HTTPS origin.";
  }

  return rawMessage;
}

function getPasskeyDisplayName(passkey: PasskeyFactor): string {
  return (
    passkey.deviceInfo?.nickname ||
    passkey.userDisplayName ||
    passkey.userName ||
    "Unnamed passkey"
  );
}

function normalizeProfileForm(payload: ProfileResponse): ProfileForm {
  return {
    name: payload.user.name ?? "",
    email: payload.user.email ?? "",
    avatarUrl: normalizeAvatarUrl(payload.user.avatar_url) ?? "",
    phone: payload.profile.phone ?? "",
    title: payload.profile.title ?? "",
    department: payload.profile.department ?? "",
    timezone: payload.profile.timezone ?? "",
    bio: payload.profile.bio ?? "",
  };
}

async function readApiError(response: Response): Promise<string> {
  try {
    const payload = (await response.json()) as { error?: string };
    if (payload.error) {
      return payload.error;
    }
  } catch {
    // Ignore parse errors and fallback below.
  }
  return response.statusText || `Request failed with status ${response.status}`;
}

export default function AccountProfilePage() {
  const dispatch = useAppDispatch();
  const activeOrgId = useAppSelector(selectTopbarActiveOrganizationId);
  const avatarInputRef = useRef<HTMLInputElement>(null);

  const [isLoading, setIsLoading] = useState(false);
  const [isSavingProfile, setIsSavingProfile] = useState(false);
  const [isUpdatingPassword, setIsUpdatingPassword] = useState(false);
  const [isUploadingAvatar, setIsUploadingAvatar] = useState(false);
  const [isDeletingAccount, setIsDeletingAccount] = useState(false);
  const [isSendingMagicLink, setIsSendingMagicLink] = useState(false);
  const [isSavingMultiStepAuth, setIsSavingMultiStepAuth] = useState(false);
  const [isLoadingPasskeys, setIsLoadingPasskeys] = useState(false);
  const [isRegisteringPasskey, setIsRegisteringPasskey] = useState(false);
  const [activeRemovingPasskeyId, setActiveRemovingPasskeyId] = useState<string | null>(null);
  const [profileUserId, setProfileUserId] = useState<string>("");
  const [profileForm, setProfileForm] = useState<ProfileForm>(EMPTY_PROFILE_FORM);
  const [initialProfileForm, setInitialProfileForm] = useState<ProfileForm>(EMPTY_PROFILE_FORM);
  const [passwordForm, setPasswordForm] = useState<PasswordForm>(EMPTY_PASSWORD_FORM);
  const [passkeys, setPasskeys] = useState<PasskeyFactor[]>([]);
  const [isMultiStepAuthEnabled, setIsMultiStepAuthEnabled] = useState(false);
  const [passkeyFriendlyName, setPasskeyFriendlyName] = useState("My Passkey");
  const [passkeyHint, setPasskeyHint] = useState<string | null>(null);
  const [deleteConfirmText, setDeleteConfirmText] = useState("");
  const [deleteConfirmEmail, setDeleteConfirmEmail] = useState("");
  const [isAvatarEditorOpen, setIsAvatarEditorOpen] = useState(false);
  const [pendingAvatarFile, setPendingAvatarFile] = useState<File | null>(null);
  const [pendingAvatarPreviewUrl, setPendingAvatarPreviewUrl] = useState<string | null>(
    null,
  );
  const [avatarSaveMode, setAvatarSaveMode] = useState<AvatarSaveMode>("square_crop");
  const { register: registerPasskeyWithWebAuthn } = useRegisterPasskey({
    endpoints: passkeyEndpoints,
  });
  const { list: listPasskeysWithWebAuthn, remove: removePasskeyWithWebAuthn } =
    useManagePasskeys({
      endpoints: passkeyEndpoints,
    });

  const loadProfile = useCallback(async () => {
    setIsLoading(true);
    try {
      const response = await fetch("/api/me/profile", {
        method: "GET",
        cache: "no-store",
      });

      if (!response.ok) {
        throw new Error(await readApiError(response));
      }

      const payload = (await response.json()) as ProfileResponse;
      const normalized = normalizeProfileForm(payload);
      setProfileUserId(payload.user.id);
      setProfileForm(normalized);
      setInitialProfileForm(normalized);
      setIsMultiStepAuthEnabled(payload.profile.multiStepAuthEnabled === true);
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : "Failed to load profile";
      toast.error(message);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const loadPasskeyFactors = useCallback(async () => {
    if (!profileUserId) {
      setPasskeys([]);
      return;
    }

    setIsLoadingPasskeys(true);
    try {
      const nextPasskeys = await listPasskeysWithWebAuthn(profileUserId);
      setPasskeys(nextPasskeys);
      setPasskeyHint(null);
    } catch (error: unknown) {
      const message = mapPasskeyErrorMessage(error);
      setPasskeyHint(message);
      setPasskeys([]);
    } finally {
      setIsLoadingPasskeys(false);
    }
  }, [listPasskeysWithWebAuthn, profileUserId]);

  useEffect(() => {
    void loadProfile();
  }, [loadProfile]);

  useEffect(() => {
    void loadPasskeyFactors();
  }, [loadPasskeyFactors]);

  const timezoneOptions = useMemo(() => {
    const intlWithSupportedValues = Intl as typeof Intl & {
      supportedValuesOf?: (key: "timeZone") => string[];
    };

    const browserTimezones =
      typeof intlWithSupportedValues.supportedValuesOf === "function"
        ? intlWithSupportedValues.supportedValuesOf("timeZone")
        : [];

    const merged = browserTimezones.length > 0 ? browserTimezones : COMMON_TIMEZONES;
    const options = Array.from(new Set(merged)).sort((a, b) => a.localeCompare(b));

    const currentTimezone = profileForm.timezone.trim();
    if (currentTimezone && !options.includes(currentTimezone)) {
      options.unshift(currentTimezone);
    }

    return options;
  }, [profileForm.timezone]);

  const initials = useMemo(() => {
    const source = profileForm.name.trim() || profileForm.email.trim();
    if (!source) {
      return "U";
    }
    const segments = source.split(/\s+/).filter(Boolean);
    if (segments.length >= 2) {
      return `${segments[0].charAt(0)}${segments[1].charAt(0)}`.toUpperCase();
    }
    return source.slice(0, 2).toUpperCase();
  }, [profileForm.email, profileForm.name]);

  const isProfileDirty =
    profileForm.name !== initialProfileForm.name ||
    profileForm.email !== initialProfileForm.email ||
    profileForm.avatarUrl !== initialProfileForm.avatarUrl ||
    profileForm.phone !== initialProfileForm.phone ||
    profileForm.title !== initialProfileForm.title ||
    profileForm.department !== initialProfileForm.department ||
    profileForm.timezone !== initialProfileForm.timezone ||
    profileForm.bio !== initialProfileForm.bio;

  const disableActions =
    isLoading ||
    isSavingProfile ||
    isUpdatingPassword ||
    isSendingMagicLink ||
    isSavingMultiStepAuth ||
    isUploadingAvatar ||
    isDeletingAccount;

  const accountEmail = initialProfileForm.email.trim().toLowerCase();
  const canDeleteAccount =
    deleteConfirmText.trim().toUpperCase() === "DELETE" &&
    deleteConfirmEmail.trim().toLowerCase() === accountEmail &&
    !isDeletingAccount;

  const handleSaveProfile = async () => {
    const payload = {
      name: profileForm.name.trim(),
      email: profileForm.email.trim(),
      avatarUrl: profileForm.avatarUrl.trim() || null,
      phone: profileForm.phone.trim() || null,
      title: profileForm.title.trim() || null,
      department: profileForm.department.trim() || null,
      timezone: profileForm.timezone.trim() || null,
      bio: profileForm.bio.trim() || null,
    };

    if (!payload.name) {
      toast.error("Name is required");
      return;
    }
    if (!payload.email) {
      toast.error("Email is required");
      return;
    }

    setIsSavingProfile(true);
    const toastId = toast.loading("Saving profile...");

    try {
      const response = await fetch("/api/me/profile", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        throw new Error(await readApiError(response));
      }

      const normalized: ProfileForm = {
        name: payload.name,
        email: payload.email,
        avatarUrl: payload.avatarUrl ?? "",
        phone: payload.phone ?? "",
        title: payload.title ?? "",
        department: payload.department ?? "",
        timezone: payload.timezone ?? "",
        bio: payload.bio ?? "",
      };
      setProfileForm(normalized);
      setInitialProfileForm(normalized);
      await dispatch(fetchTopbarData());
      toast.success("Profile updated", { id: toastId });
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : "Failed to update profile";
      toast.error(message, { id: toastId });
    } finally {
      setIsSavingProfile(false);
    }
  };

  const handleAvatarSelect = () => {
    if (!disableActions) {
      avatarInputRef.current?.click();
    }
  };

  const handleAvatarUpload = useCallback(async (file: File) => {
    setIsUploadingAvatar(true);
    const toastId = toast.loading("Uploading avatar...");
    let isSuccess = false;

    try {
      const formData = new FormData();
      formData.append("file", file);

      const response = await fetch("/api/me/avatar", {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        throw new Error(await readApiError(response));
      }

      const payload = (await response.json()) as { avatarUrl?: string };
      if (!payload.avatarUrl) {
        throw new Error("Avatar uploaded but response is missing avatarUrl");
      }

      setProfileForm((prev) => ({
        ...prev,
        avatarUrl: payload.avatarUrl ?? "",
      }));
      setInitialProfileForm((prev) => ({
        ...prev,
        avatarUrl: payload.avatarUrl ?? "",
      }));
      await dispatch(fetchTopbarData());
      toast.success("Avatar updated", { id: toastId });
      isSuccess = true;
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : "Failed to upload avatar";
      toast.error(message, { id: toastId });
    } finally {
      setIsUploadingAvatar(false);
      if (avatarInputRef.current) {
        avatarInputRef.current.value = "";
      }
    }

    return isSuccess;
  }, [dispatch]);

  useEffect(() => {
    return () => {
      if (pendingAvatarPreviewUrl) {
        URL.revokeObjectURL(pendingAvatarPreviewUrl);
      }
    };
  }, [pendingAvatarPreviewUrl]);

  const clearPendingAvatar = useCallback(() => {
    if (pendingAvatarPreviewUrl) {
      URL.revokeObjectURL(pendingAvatarPreviewUrl);
    }
    setPendingAvatarPreviewUrl(null);
    setPendingAvatarFile(null);
    setAvatarSaveMode("square_crop");
    if (avatarInputRef.current) {
      avatarInputRef.current.value = "";
    }
  }, [pendingAvatarPreviewUrl]);

  const loadImageFromFile = useCallback(async (file: File): Promise<HTMLImageElement> => {
    const objectUrl = URL.createObjectURL(file);
    return await new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => {
        URL.revokeObjectURL(objectUrl);
        resolve(image);
      };
      image.onerror = () => {
        URL.revokeObjectURL(objectUrl);
        reject(new Error("Failed to read image"));
      };
      image.src = objectUrl;
    });
  }, []);

  const canvasToBlob = useCallback(
    async (canvas: HTMLCanvasElement): Promise<Blob> =>
      await new Promise((resolve, reject) => {
        canvas.toBlob(
          (blob) => {
            if (!blob) {
              reject(new Error("Failed to process image"));
              return;
            }
            resolve(blob);
          },
          "image/webp",
          0.92,
        );
      }),
    [],
  );

  const prepareAvatarFileForUpload = useCallback(
    async (sourceFile: File, mode: AvatarSaveMode): Promise<File> => {
      if (mode === "original") {
        return sourceFile;
      }

      const image = await loadImageFromFile(sourceFile);
      const canvas = document.createElement("canvas");
      canvas.width = AVATAR_CANVAS_SIZE;
      canvas.height = AVATAR_CANVAS_SIZE;

      const context = canvas.getContext("2d");
      if (!context) {
        throw new Error("Failed to process image");
      }

      if (mode === "square_fit") {
        context.fillStyle = "#f8fafc";
        context.fillRect(0, 0, AVATAR_CANVAS_SIZE, AVATAR_CANVAS_SIZE);

        const fitScale = Math.min(
          AVATAR_CANVAS_SIZE / image.width,
          AVATAR_CANVAS_SIZE / image.height,
        );
        const drawWidth = image.width * fitScale;
        const drawHeight = image.height * fitScale;
        const dx = (AVATAR_CANVAS_SIZE - drawWidth) / 2;
        const dy = (AVATAR_CANVAS_SIZE - drawHeight) / 2;

        context.drawImage(image, dx, dy, drawWidth, drawHeight);
      } else {
        const cropSize = Math.min(image.width, image.height);
        const sx = (image.width - cropSize) / 2;
        const sy = (image.height - cropSize) / 2;

        context.drawImage(
          image,
          sx,
          sy,
          cropSize,
          cropSize,
          0,
          0,
          AVATAR_CANVAS_SIZE,
          AVATAR_CANVAS_SIZE,
        );
      }

      const blob = await canvasToBlob(canvas);
      const baseName = sourceFile.name.replace(/\.[^/.]+$/, "").trim() || "avatar";
      return new File([blob], `${baseName}-${mode}.webp`, {
        type: "image/webp",
        lastModified: Date.now(),
      });
    },
    [canvasToBlob, loadImageFromFile],
  );

  const handleConfirmAvatarUpload = useCallback(async () => {
    if (!pendingAvatarFile) {
      return;
    }

    try {
      const fileToUpload = await prepareAvatarFileForUpload(
        pendingAvatarFile,
        avatarSaveMode,
      );
      const uploaded = await handleAvatarUpload(fileToUpload);
      if (uploaded) {
        setIsAvatarEditorOpen(false);
        clearPendingAvatar();
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Failed to process image";
      toast.error(message);
    }
  }, [
    avatarSaveMode,
    clearPendingAvatar,
    handleAvatarUpload,
    pendingAvatarFile,
    prepareAvatarFileForUpload,
  ]);

  const closeAvatarEditor = useCallback(() => {
    setIsAvatarEditorOpen(false);
    clearPendingAvatar();
  }, [clearPendingAvatar]);

  const handleFileInputChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    if (!file.type.startsWith("image/")) {
      toast.error("Please select a valid image file");
      return;
    }

    if (file.size > 2 * 1024 * 1024) {
      toast.error("Image must be 2MB or smaller");
      return;
    }

    if (pendingAvatarPreviewUrl) {
      URL.revokeObjectURL(pendingAvatarPreviewUrl);
    }
    setPendingAvatarFile(file);
    setPendingAvatarPreviewUrl(URL.createObjectURL(file));
    setAvatarSaveMode("square_crop");
    setIsAvatarEditorOpen(true);
  };

  const handleUpdatePassword = async () => {
    const newPassword = passwordForm.newPassword.trim();
    const confirmPassword = passwordForm.confirmPassword.trim();

    if (!newPassword || !confirmPassword) {
      toast.error("Please fill in both password fields");
      return;
    }
    if (newPassword.length < 8) {
      toast.error("Password must be at least 8 characters long");
      return;
    }
    if (newPassword !== confirmPassword) {
      toast.error("Passwords do not match");
      return;
    }

    setIsUpdatingPassword(true);
    const toastId = toast.loading("Updating password...");

    try {
      const response = await fetch("/api/me/profile", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          newPassword,
        }),
      });

      if (!response.ok) {
        throw new Error(await readApiError(response));
      }

      setPasswordForm(EMPTY_PASSWORD_FORM);
      toast.success("Password updated", { id: toastId });
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : "Failed to update password";
      toast.error(message, { id: toastId });
    } finally {
      setIsUpdatingPassword(false);
    }
  };

  const handleSendMagicLink = async () => {
    setIsSendingMagicLink(true);
    const toastId = toast.loading("Sending magic link...");

    try {
      const response = await fetch("/api/auth/passwordless/magic-link", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ email: profileForm.email }),
      });

      if (!response.ok) {
        throw new Error(await readApiError(response));
      }

      toast.success("Magic link sent to your email", { id: toastId });
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : "Failed to send magic link";
      toast.error(message, { id: toastId });
    } finally {
      setIsSendingMagicLink(false);
    }
  };

  const handleToggleMultiStepAuth = async (nextEnabled: boolean) => {
    setIsSavingMultiStepAuth(true);
    const toastId = toast.loading(
      nextEnabled ? "Enabling multi-step auth..." : "Disabling multi-step auth...",
    );

    try {
      const response = await fetch("/api/me/profile", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          multiStepAuthEnabled: nextEnabled,
        }),
      });

      if (!response.ok) {
        throw new Error(await readApiError(response));
      }

      setIsMultiStepAuthEnabled(nextEnabled);
      toast.success(
        nextEnabled
          ? "Multi-step authentication enabled"
          : "Multi-step authentication disabled",
        { id: toastId },
      );
    } catch (error: unknown) {
      const message =
        error instanceof Error
          ? error.message
          : "Failed to update multi-step authentication";
      toast.error(message, { id: toastId });
    } finally {
      setIsSavingMultiStepAuth(false);
    }
  };

  const handleRegisterPasskey = async () => {
    if (typeof window === "undefined" || !("PublicKeyCredential" in window)) {
      toast.error("Passkeys are not supported in this browser");
      return;
    }
    if (!window.isSecureContext) {
      toast.error(
        "Passkeys require HTTPS (or localhost). On phone, use your HTTPS domain.",
      );
      return;
    }
    if (!profileUserId) {
      toast.error("Profile is not loaded yet. Please try again.");
      return;
    }

    const friendlyName = passkeyFriendlyName.trim() || "My Passkey";
    setIsRegisteringPasskey(true);
    const toastId = toast.loading("Registering passkey...");

    try {
      const registrationOptions: Parameters<
        typeof registerPasskeyWithWebAuthn
      >[1] = {
        userName: profileForm.email.trim() || profileUserId,
        userDisplayName: friendlyName,
      };
      await registerPasskeyWithWebAuthn(profileUserId, registrationOptions);

      toast.success("Passkey registered", { id: toastId });
      setPasskeyFriendlyName("My Passkey");
      await loadPasskeyFactors();
    } catch (error: unknown) {
      const message = mapPasskeyErrorMessage(error);
      setPasskeyHint(message);
      toast.error(message, { id: toastId });
    } finally {
      setIsRegisteringPasskey(false);
    }
  };

  const handleRemovePasskey = async (credentialId: string) => {
    if (!profileUserId) {
      toast.error("Profile is not loaded yet. Please try again.");
      return;
    }

    setActiveRemovingPasskeyId(credentialId);
    const toastId = toast.loading("Removing passkey...");

    try {
      await removePasskeyWithWebAuthn(profileUserId, credentialId);
      toast.success("Passkey removed", { id: toastId });
      await loadPasskeyFactors();
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : "Failed to remove passkey";
      toast.error(message, { id: toastId });
    } finally {
      setActiveRemovingPasskeyId(null);
    }
  };

  const handleDeleteAccount = async () => {
    setIsDeletingAccount(true);
    const toastId = toast.loading("Deleting account...");

    try {
      const response = await fetch("/api/me/account", {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          confirmation: deleteConfirmText.trim(),
          email: deleteConfirmEmail.trim(),
        }),
      });

      if (!response.ok) {
        throw new Error(await readApiError(response));
      }

      toast.success("Account deleted", { id: toastId });
      await signOut({ callbackUrl: "/login?deleted=1" });
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : "Failed to delete account";
      toast.error(message, { id: toastId });
      setIsDeletingAccount(false);
    }
  };

  return (
    <div className="w-full space-y-8 p-6 lg:p-8">
      <div className="rounded-2xl border border-border bg-background p-5 shadow-sm lg:p-6">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-3xl font-semibold text-foreground">Account Profile</h1>
            <p className="mt-1 text-muted-foreground">
              Manage your identity, personal details, security, and account lifecycle.
            </p>
          </div>
          <div className="flex gap-2">
            <Badge variant="secondary" className="gap-1">
              <ShieldCheck className="h-3.5 w-3.5" />
              Secure Account
            </Badge>
            {activeOrgId ? (
              <Badge variant="secondary" className="font-mono text-xs">
                Org: {activeOrgId.slice(0, 8)}
              </Badge>
            ) : null}
          </div>
        </div>
      </div>

      <section className="space-y-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Profile and Identity
        </p>
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <Card className="border-border shadow-sm lg:col-span-1">
          <CardHeader>
            <CardTitle>Profile Picture</CardTitle>
            <CardDescription>
              Upload your own image, adjust save mode, or keep a URL-based avatar.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-col items-center text-center gap-3">
              <div className="relative">
                <Avatar className="h-28 w-28 border border-border">
                  <AvatarImage src={profileForm.avatarUrl || undefined} alt="Profile avatar" />
                  <AvatarFallback className="text-lg font-medium text-foreground">
                    {initials}
                  </AvatarFallback>
                </Avatar>
                <button
                  type="button"
                  onClick={handleAvatarSelect}
                  disabled={disableActions}
                  className="absolute -bottom-2 -right-2 rounded-full bg-primary p-2 text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
                  aria-label="Upload avatar"
                >
                  {isUploadingAvatar ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Camera className="h-4 w-4" />
                  )}
                </button>
              </div>

              <input
                ref={avatarInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif"
                className="hidden"
                onChange={handleFileInputChange}
              />

              <Button
                type="button"
                variant="outline"
                onClick={handleAvatarSelect}
                disabled={disableActions}
                className="w-full"
              >
                {isUploadingAvatar ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Uploading...
                  </>
                ) : (
                  "Upload New Image"
                )}
              </Button>
            </div>

            <div className="space-y-2">
              <Label htmlFor="avatar-url">Avatar URL</Label>
              <Input
                id="avatar-url"
                type="url"
                placeholder="https://example.com/avatar.png"
                value={profileForm.avatarUrl}
                onChange={(event) =>
                  setProfileForm((prev) => ({
                    ...prev,
                    avatarUrl: event.target.value,
                  }))
                }
                disabled={disableActions}
              />
              <p className="text-xs text-muted-foreground">
                You can upload a file or paste an image URL. Max upload size is 2MB.
              </p>
            </div>
          </CardContent>
          </Card>

          <Card className="border-border shadow-sm lg:col-span-2">
          <CardHeader>
            <CardTitle>Personal Details</CardTitle>
            <CardDescription>
              Keep your profile complete so teammates can identify and contact you.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="name">Full Name</Label>
                <Input
                  id="name"
                  value={profileForm.name}
                  onChange={(event) =>
                    setProfileForm((prev) => ({
                      ...prev,
                      name: event.target.value,
                    }))
                  }
                  disabled={disableActions}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  value={profileForm.email}
                  onChange={(event) =>
                    setProfileForm((prev) => ({
                      ...prev,
                      email: event.target.value,
                    }))
                  }
                  disabled={disableActions}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="phone">Phone</Label>
                <Input
                  id="phone"
                  value={profileForm.phone}
                  onChange={(event) =>
                    setProfileForm((prev) => ({
                      ...prev,
                      phone: event.target.value,
                    }))
                  }
                  disabled={disableActions}
                  placeholder="+1 555 555 5555"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="timezone">Timezone</Label>
                <Select
                  value={profileForm.timezone || TIMEZONE_UNSET_VALUE}
                  onValueChange={(value) =>
                    setProfileForm((prev) => ({
                      ...prev,
                      timezone: value === TIMEZONE_UNSET_VALUE ? "" : value,
                    }))
                  }
                  disabled={disableActions}
                >
                  <SelectTrigger id="timezone" className="focus:ring-2 focus-visible:ring-ring">
                    <SelectValue placeholder="Select timezone" />
                  </SelectTrigger>
                  <SelectContent className="max-h-80">
                    <SelectItem value={TIMEZONE_UNSET_VALUE}>No timezone</SelectItem>
                    {timezoneOptions.map((timezone) => (
                      <SelectItem key={timezone} value={timezone}>
                        {timezone}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="title">Job Title</Label>
                <Input
                  id="title"
                  value={profileForm.title}
                  onChange={(event) =>
                    setProfileForm((prev) => ({
                      ...prev,
                      title: event.target.value,
                    }))
                  }
                  disabled={disableActions}
                  placeholder="Operations Manager"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="department">Department</Label>
                <Input
                  id="department"
                  value={profileForm.department}
                  onChange={(event) =>
                    setProfileForm((prev) => ({
                      ...prev,
                      department: event.target.value,
                    }))
                  }
                  disabled={disableActions}
                  placeholder="Customer Success"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="bio">Bio</Label>
              <Textarea
                id="bio"
                value={profileForm.bio}
                onChange={(event) =>
                  setProfileForm((prev) => ({
                    ...prev,
                    bio: event.target.value,
                  }))
                }
                disabled={disableActions}
                placeholder="Tell your team a bit about your role and focus."
                rows={4}
              />
            </div>

            <div className="flex flex-wrap justify-between gap-3 border-t border-border/60 pt-4">
              <div className="text-sm text-muted-foreground flex items-center gap-2">
                <UserRound className="h-4 w-4" />
                User ID: <span className="font-mono">{profileUserId || "-"}</span>
              </div>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  onClick={() => setProfileForm(initialProfileForm)}
                  disabled={!isProfileDirty || disableActions}
                >
                  Cancel
                </Button>
                <Button
                  onClick={handleSaveProfile}
                  disabled={!isProfileDirty || disableActions}
                >
                  {isSavingProfile ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Saving...
                    </>
                  ) : (
                    <>
                      <Save className="mr-2 h-4 w-4" />
                      Save Profile
                    </>
                  )}
                </Button>
              </div>
            </div>
          </CardContent>
          </Card>
        </div>
      </section>

      <section className="space-y-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Security and Access
        </p>
        <Card className="border-border shadow-sm">
        <CardHeader>
          <CardTitle>Security</CardTitle>
          <CardDescription>
            Manage passwordless sign-in with magic links and passkeys.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="new-password">New Password</Label>
              <Input
                id="new-password"
                type="password"
                value={passwordForm.newPassword}
                onChange={(event) =>
                  setPasswordForm((prev) => ({
                    ...prev,
                    newPassword: event.target.value,
                  }))
                }
                disabled={disableActions}
                placeholder="At least 8 characters"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirm-password">Confirm Password</Label>
              <Input
                id="confirm-password"
                type="password"
                value={passwordForm.confirmPassword}
                onChange={(event) =>
                  setPasswordForm((prev) => ({
                    ...prev,
                    confirmPassword: event.target.value,
                  }))
                }
                disabled={disableActions}
              />
            </div>
          </div>
          <div className="flex justify-end">
            <Button onClick={handleUpdatePassword} disabled={disableActions}>
              {isUpdatingPassword ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Updating...
                </>
              ) : (
                "Update Password"
              )}
            </Button>
          </div>

          <div className="border-t border-border/60 pt-5 space-y-4">
            <div className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2.5">
              <div className="space-y-1">
                <p className="text-sm font-medium text-foreground">Multi-Step Authentication</p>
                <p className="text-xs text-muted-foreground">
                  Require an email verification code after first-step sign-in.
                </p>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-xs text-muted-foreground">
                  {isMultiStepAuthEnabled ? "Enabled" : "Disabled"}
                </span>
                <Switch
                  checked={isMultiStepAuthEnabled}
                  onCheckedChange={(checked) => void handleToggleMultiStepAuth(checked)}
                  disabled={disableActions || isSavingMultiStepAuth}
                  aria-label="Toggle multi-step authentication"
                />
              </div>
            </div>

            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium text-foreground">Passwordless Sign-In</p>
                <p className="text-xs text-muted-foreground">
                  Send login links to your email and register passkeys for faster sign-in.
                </p>
              </div>
              <Button
                variant="outline"
                onClick={handleSendMagicLink}
                disabled={disableActions || isSendingMagicLink}
              >
                {isSendingMagicLink ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Sending...
                  </>
                ) : (
                  "Email Magic Link"
                )}
              </Button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div className="md:col-span-2 space-y-2">
                <Label htmlFor="passkey-name">Passkey Name</Label>
                <div className="rounded-xl border border-border bg-gradient-to-br from-background to-muted/60 p-3 shadow-sm">
                  <div className="flex items-start gap-3">
                    <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border bg-background text-muted-foreground">
                      <KeyRound className="h-4 w-4" />
                    </div>
                    <div className="min-w-0 flex-1 space-y-1.5">
                      <Input
                        id="passkey-name"
                        value={passkeyFriendlyName}
                        onChange={(event) => setPasskeyFriendlyName(event.target.value)}
                        placeholder="My Laptop Passkey"
                        disabled={disableActions || isRegisteringPasskey}
                        className="h-11 border-border bg-background text-sm font-medium shadow-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30"
                      />
                      <p className="text-xs text-muted-foreground">
                        Use a recognizable device label like Work Laptop or
                        iPhone 16 Pro.
                      </p>
                    </div>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">
                  On desktop, choose your phone/tablet from the browser passkey prompt.
                  Keep Bluetooth enabled for cross-device setup.
                </p>
              </div>
              <div className="flex items-end">
                <Button
                  className="w-full md:h-11"
                  onClick={handleRegisterPasskey}
                  disabled={
                    disableActions ||
                    isRegisteringPasskey ||
                    isLoadingPasskeys
                  }
                >
                  {isRegisteringPasskey ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Registering...
                    </>
                  ) : (
                    <>
                      <KeyRound className="mr-2 h-4 w-4" />
                      Add Passkey
                    </>
                  )}
                </Button>
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium text-foreground">Registered Passkeys</p>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => void loadPasskeyFactors()}
                  disabled={isLoadingPasskeys}
                >
                  {isLoadingPasskeys ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    "Refresh"
                  )}
                </Button>
              </div>
              {passkeys.length === 0 ? (
                <p className="text-xs text-muted-foreground">No passkeys registered yet.</p>
              ) : (
                <div className="space-y-2">
                  {passkeys.map((factor) => (
                    <div
                      key={factor.id}
                      className="flex items-center justify-between rounded-md border border-border px-3 py-2"
                    >
                      <div>
                        <p className="text-sm font-medium text-foreground">
                          {getPasskeyDisplayName(factor)}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          Added {new Date(factor.createdAt).toLocaleString()}
                        </p>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => void handleRemovePasskey(factor.credentialId)}
                        disabled={activeRemovingPasskeyId === factor.credentialId}
                      >
                        {activeRemovingPasskeyId === factor.credentialId ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          "Remove"
                        )}
                      </Button>
                    </div>
                  ))}
                </div>
              )}
              {passkeyHint ? (
                <p className="text-xs text-amber-700">{passkeyHint}</p>
              ) : null}
            </div>
          </div>
        </CardContent>
        </Card>
      </section>

      <section className="space-y-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-red-500">
          Critical Actions
        </p>
        <Card className="border-red-200 shadow-sm">
        <CardHeader>
          <CardTitle className="text-red-600">Danger Zone</CardTitle>
          <CardDescription>
            Deleting your account is irreversible and will revoke your access immediately.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-lg border border-red-200 bg-red-50 p-4 space-y-3">
            <div className="flex items-center gap-2 text-red-700">
              <AlertTriangle className="h-4 w-4" />
              <p className="text-sm font-medium">
                This will remove your memberships and sign you out permanently.
              </p>
            </div>
            <p className="text-xs text-red-700/80">
              If you are the last admin in an organization, deletion will be blocked
              until another admin is assigned.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="delete-confirm-text">Type DELETE</Label>
              <Input
                id="delete-confirm-text"
                value={deleteConfirmText}
                onChange={(event) => setDeleteConfirmText(event.target.value)}
                placeholder="DELETE"
                disabled={disableActions}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="delete-confirm-email">Confirm Your Email</Label>
              <Input
                id="delete-confirm-email"
                value={deleteConfirmEmail}
                onChange={(event) => setDeleteConfirmEmail(event.target.value)}
                placeholder={accountEmail || "you@example.com"}
                disabled={disableActions}
              />
            </div>
          </div>

          <div className="flex justify-end">
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  variant="destructive"
                  disabled={!canDeleteAccount || disableActions}
                >
                  Delete My Account
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle className="flex items-center gap-2">
                    <Mail className="h-4 w-4" />
                    Final Confirmation
                  </AlertDialogTitle>
                  <AlertDialogDescription>
                    This action cannot be undone. Your login access will be deleted
                    immediately and you will be signed out.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel disabled={isDeletingAccount}>
                    Cancel
                  </AlertDialogCancel>
                  <AlertDialogAction
                    onClick={(event) => {
                      event.preventDefault();
                      void handleDeleteAccount();
                    }}
                    disabled={!canDeleteAccount || isDeletingAccount}
                    className="bg-red-600 hover:bg-red-700 focus:ring-red-600"
                  >
                    {isDeletingAccount ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Deleting...
                      </>
                    ) : (
                      "Permanently Delete"
                    )}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </CardContent>
        </Card>
      </section>

      {isLoading ? (
        <div className="flex items-center rounded-md border border-border bg-background px-3 py-2 text-sm text-muted-foreground">
          <Loader2 className="w-4 h-4 mr-2 animate-spin" />
          Loading profile...
        </div>
      ) : null}

      <Dialog open={isAvatarEditorOpen} onOpenChange={(open) => {
        if (!open) {
          closeAvatarEditor();
          return;
        }
        setIsAvatarEditorOpen(true);
      }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Edit Avatar</DialogTitle>
            <DialogDescription>
              Choose how this image should be saved before uploading.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="mx-auto">
              <div
                className={`h-36 w-36 overflow-hidden rounded-full border border-border ${
                  avatarSaveMode === "square_fit" ? "bg-muted/50" : "bg-background"
                }`}
              >
                {pendingAvatarPreviewUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={pendingAvatarPreviewUrl}
                    alt="Avatar preview"
                    className={`h-full w-full ${
                      avatarSaveMode === "square_fit" ? "object-contain" : "object-cover"
                    }`}
                  />
                ) : null}
              </div>
            </div>

            <RadioGroup
              value={avatarSaveMode}
              onValueChange={(value) => setAvatarSaveMode(value as AvatarSaveMode)}
              className="space-y-3"
            >
              <label
                htmlFor="avatar-mode-square-crop"
                className="flex cursor-pointer items-start gap-3 rounded-md border border-border p-3 hover:bg-muted/50"
              >
                <RadioGroupItem id="avatar-mode-square-crop" value="square_crop" />
                <div>
                  <p className="text-sm font-medium text-foreground">Square Crop (Recommended)</p>
                  <p className="text-xs text-muted-foreground">
                    Center crop to a clean square and optimize size.
                  </p>
                </div>
              </label>

              <label
                htmlFor="avatar-mode-square-fit"
                className="flex cursor-pointer items-start gap-3 rounded-md border border-border p-3 hover:bg-muted/50"
              >
                <RadioGroupItem id="avatar-mode-square-fit" value="square_fit" />
                <div>
                  <p className="text-sm font-medium text-foreground">Fit in Square</p>
                  <p className="text-xs text-muted-foreground">
                    Keep full image visible with soft background padding.
                  </p>
                </div>
              </label>

              <label
                htmlFor="avatar-mode-original"
                className="flex cursor-pointer items-start gap-3 rounded-md border border-border p-3 hover:bg-muted/50"
              >
                <RadioGroupItem id="avatar-mode-original" value="original" />
                <div>
                  <p className="text-sm font-medium text-foreground">Keep Original</p>
                  <p className="text-xs text-muted-foreground">
                    Upload the exact selected file without processing.
                  </p>
                </div>
              </label>
            </RadioGroup>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={closeAvatarEditor} disabled={isUploadingAvatar}>
              Cancel
            </Button>
            <Button onClick={() => void handleConfirmAvatarUpload()} disabled={isUploadingAvatar}>
              {isUploadingAvatar ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Uploading...
                </>
              ) : (
                "Save & Upload"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

