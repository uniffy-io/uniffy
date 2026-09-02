// Derived from the Jitsi Meet SDK broadcast extension sample (Apache License 2.0).
import Foundation

// The uploader's ready flag is flipped from ReplayKit's sample queue and from
// the socket's stream queue at once.
@propertyWrapper
struct Atomic<Value> {
  private var value: Value
  private let lock = NSLock()

  init(wrappedValue value: Value) {
    self.value = value
  }

  var wrappedValue: Value {
    get { return load() }
    set { store(newValue: newValue) }
  }

  func load() -> Value {
    lock.lock()
    defer { lock.unlock() }
    return value
  }

  mutating func store(newValue: Value) {
    lock.lock()
    defer { lock.unlock() }
    value = newValue
  }
}
