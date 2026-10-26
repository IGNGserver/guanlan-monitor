package com.dsc.android

import org.junit.Assert.*
import org.junit.Test

class UpdateVersionTest {
  @Test fun semverAndAndroidCodeRemainMonotonic() {
    assertEquals(1, compareUpdateVersions("1.0.0-beta.10", "1.0.0-beta.2"))
    assertEquals(1, compareUpdateVersions("1.0.0", "1.0.0-rc.9"))
    assertEquals(0, compareUpdateVersions("1.0.0+one", "1.0.0+two"))
    assertNull(compareUpdateVersions("not-a-version", "1.0.0"))
    assertEquals(3_000_167L, updateVersionCode("3.0.167"))
    assertEquals(-1L, updateVersionCode("3.0.168-rc.1"))
    assertTrue(updateVersionCode("3.1.0") > updateVersionCode("3.0.9999"))
  }
}
