# R8 / ProGuard rules for Device State Console (Guanlan) Android App

# 1. General & Attributes
-keepattributes *Annotation*, InnerClasses, EnclosingMethod, Signature, Exceptions
-keepattributes SourceFile, LineNumberTable

# 2. Kotlin & Coroutines
-dontwarn kotlinx.coroutines.**
-keepclassmembers class kotlinx.coroutines.** {
    volatile <fields>;
}

# 3. Kotlinx Serialization
# Prevent R8 from stripping serializer classes, companion objects, and annotated properties.
-dontnote kotlinx.serialization.**
-keepclassmembers class * {
    @kotlinx.serialization.Serializable <fields>;
}
-keepclassmembers class * {
    @kotlinx.serialization.SerialName <fields>;
}
-keepclassmembers class * {
    companion object;
}
-keepclasseswithmembers class * {
    kotlinx.serialization.KSerializer serializer(...);
}
-keep,allowobfuscation,allowshrinking class * extends kotlinx.serialization.internal.GeneratedSerializer { *; }

# Keep all models used in network and cache explicitly
-keep class com.dsc.android.model.** { *; }
-keep class com.dsc.android.cache.** { *; }
-keep class com.dsc.android.**Dto { *; }

# 4. Retrofit & OkHttp
-dontwarn okhttp3.**
-dontwarn okio.**
-dontwarn retrofit2.**
-keep class retrofit2.** { *; }
-keepclasseswithmembers interface * {
    @retrofit2.http.* <methods>;
}

# 5. Jetpack Security Crypto (EncryptedSharedPreferences)
-keep class androidx.security.crypto.** { *; }
-dontwarn com.google.crypto.tink.**
-keep class com.google.crypto.tink.** { *; }

# 6. Compose Runtime & Navigation
-dontwarn androidx.compose.**
-keep class androidx.compose.material3.** { *; }
-keep class androidx.navigation.** { *; }

