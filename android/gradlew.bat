@ECHO OFF
SET DIR=%~dp0
IF NOT "%JAVA_HOME%"=="" (
  SET JAVA_CMD=%JAVA_HOME%\bin\java.exe
) ELSE (
  SET JAVA_CMD=java
)
"%JAVA_CMD%" -classpath "%DIR%\gradle\wrapper\gradle-wrapper.jar" org.gradle.wrapper.GradleWrapperMain %*
