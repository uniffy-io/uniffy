require 'json'

package = JSON.parse(File.read(File.join(__dir__, '..', 'package.json')))

Pod::Spec.new do |s|
  s.name           = 'ScreenSharePicker'
  s.version        = package['version']
  s.summary        = package['description']
  s.description    = package['description']
  s.license        = 'FSL-1.1-Apache-2.0'
  s.author         = 'Uniffy'
  s.homepage       = 'https://uniffy.io'
  s.platforms      = { :ios => '15.1' }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
  }

  s.source_files = '**/*.{h,m,swift}'
end
