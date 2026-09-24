package com.dsc.android

import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test

class ServerUrlPolicyTest {
  @Test
  fun acceptsHttpsForPublicHub() {
    assertEquals(
      "https://hub.example.com:3100",
      ServerUrlPolicy.normalize(" https://hub.example.com:3100/ ")
    )
  }

  @Test
  fun acceptsHttpForPrivateAndPublicHub() {
    assertEquals(
      "http://192.168.1.20:3100",
      ServerUrlPolicy.normalize("192.168.1.20:3100")
    )
    assertEquals("http://localhost:3100", ServerUrlPolicy.normalize("http://localhost:3100/"))
    assertEquals("http://[fd00::20]:3100", ServerUrlPolicy.normalize("http://[fd00::20]:3100"))
    assertEquals("http://hub.example.com:3100", ServerUrlPolicy.normalize("http://hub.example.com:3100"))
  }

  @Test
  fun rejectsEmbeddedCredentials() {
    assertThrows(InvalidServerUrlException::class.java) {
      ServerUrlPolicy.normalize("https://user:password@hub.example.com:3100")
    }
  }
}
