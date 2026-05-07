Pod::Spec.new do |s|
  vendored_frameworks = Dir.glob("Vendor/LiteRTLM/*.xcframework")

  s.name           = 'AgentRuntime'
  s.version        = '1.0.0'
  s.summary        = 'A sample project summary'
  s.description    = 'A sample project description'
  s.author         = ''
  s.homepage       = 'https://docs.expo.dev/modules/'
  s.platforms      = {
    :ios => '15.1',
    :tvos => '15.1'
  }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  s.frameworks = [
    'AVFAudio',
    'AVFoundation',
    'AudioToolbox',
    'CoreFoundation',
    'Foundation',
    'Metal',
    'Security'
  ]

  # Swift/Objective-C compatibility
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'CLANG_CXX_LANGUAGE_STANDARD' => 'c++20',
    'OTHER_LDFLAGS' => '$(inherited) -lc++',
  }

  s.source_files = "**/*.{h,m,mm,swift,hpp,cpp}"
  s.preserve_paths = ["Vendor/LiteRTLM/**/*"]

  unless vendored_frameworks.empty?
    s.vendored_frameworks = vendored_frameworks
  end
end
