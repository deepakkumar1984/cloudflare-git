import { describe, expect, it } from "vitest";
import {
  firstAccountMustMatchAdminList,
  grantInitialAdmin,
  publicSignupAllowed,
} from "@shared/constants";

const admins = new Set(["owner@example.com"]);

describe("signup policy", () => {
  it("leaves development open and closes production after the first account", () => {
    expect(publicSignupAllowed("development", undefined, true)).toBe(true);
    expect(publicSignupAllowed(undefined, undefined, false)).toBe(true);
    expect(publicSignupAllowed(undefined, undefined, true)).toBe(false);
    expect(publicSignupAllowed(undefined, "true", true)).toBe(true);
  });

  it("grants admin only to the first listed address", () => {
    expect(grantInitialAdmin(true, "owner@example.com", admins)).toBe(true);
    expect(grantInitialAdmin(false, "owner@example.com", admins)).toBe(false);
    expect(grantInitialAdmin(true, "other@example.com", admins)).toBe(false);
    expect(firstAccountMustMatchAdminList(undefined, true, admins)).toBe(true);
    expect(firstAccountMustMatchAdminList("development", true, admins)).toBe(
      false
    );
  });
});
